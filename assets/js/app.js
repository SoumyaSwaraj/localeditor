/* LocalEditor shell. Existing tool pages keep the IT helpers they already call. */
(function () {
  'use strict';

  var root = document.documentElement;
  try {
    var saved = localStorage.getItem('le-theme') || localStorage.getItem('it-theme');
    if (saved) root.setAttribute('data-theme', saved);
    else if (!root.getAttribute('data-theme')) root.setAttribute('data-theme', window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var savedSkin = localStorage.getItem('le-skin');
    if (savedSkin && savedSkin !== 'clear' && /^[a-z]+$/.test(savedSkin)) root.setAttribute('data-skin', savedSkin); else root.removeAttribute('data-skin');
  } catch (e) {}
  document.body.classList.add('le-ready');

  /* Canvas surround for the editors: light, mid or dark grey around the page, or follow the theme.
     Neutral greys only, so people judge their own colours fairly (docs/DESIGN.md, "Neutral chrome"). */
  var LEX = window.LE = window.LE || {};
  LEX.surround = {
    get: function () { try { return localStorage.getItem('le-surround') || 'auto'; } catch (e) { return 'auto'; } },
    set: function (v) {
      try { if (v === 'auto') localStorage.removeItem('le-surround'); else localStorage.setItem('le-surround', v); } catch (e) {}
      if (v === 'light' || v === 'mid' || v === 'dark') root.setAttribute('data-surround', v); else root.removeAttribute('data-surround');
    },
    /* One section for a studio settings panel: LE.surround.section(ctx, body). */
    section: function (c, body) {
      if (!c || !c.ui || !c.ui.section || !c.ui.seg) return;
      if (LEX.appearance && !body.querySelector('.ap')) LEX.appearance.section(c, body);
      var s = c.ui.section('Canvas surround');
      s.querySelector('.sx-sec-body').appendChild(c.ui.seg([['auto', 'Auto'], ['light', 'Light'], ['mid', 'Mid grey'], ['dark', 'Dark']], LEX.surround.get(), function (v) { LEX.surround.set(v); if (c.renderPanel) c.renderPanel(true); }));
      var p = document.createElement('p');
      p.className = 'sx-note';
      p.textContent = 'The grey around your page. Auto follows the theme, and uses mid grey in Expert, the fairest for judging colour.';
      s.querySelector('.sx-sec-body').appendChild(p);
      body.appendChild(s);
    }
  };
  LEX.surround.set(LEX.surround.get());

  /* Appearance: a theme (a token set, html[data-skin]) and a mode (light, dark or auto), both stored on this device.
     Themes never touch exports: designs and PDFs render from the document, not from the interface tokens. */
  var SKINS = [
    { id: 'clear', name: 'Clear', note: 'Light and airy, system type. The default.' },
    { id: 'lapis', name: 'Lapis', note: 'The original look: Lapis blue and serif accents.' },
    { id: 'graphite', name: 'Graphite', note: 'Monochrome, compact and square.' },
    { id: 'paper', name: 'Paper', note: 'Warm and calm for long reading.' },
    { id: 'contrast', name: 'Contrast', note: 'Strongest contrast, larger text and targets.' }
  ];
  var aplisteners = [];
  function lsGetA(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSetA(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function systemDark() { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function themeColor() {
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!meta) return;
    var cs = getComputedStyle(root), studio = document.body.classList.contains('sx-body') || document.body.classList.contains('ps-body');
    var c = (studio ? cs.getPropertyValue('--side') : cs.getPropertyValue('--bar-solid') || cs.getPropertyValue('--bg')).trim();
    if (c && /^#|^rgb/.test(c)) meta.setAttribute('content', c);
  }
  function apChanged() {
    themeColor();
    aplisteners.forEach(function (fn) { try { fn(LEX.appearance.state()); } catch (e) {} });
    try { document.dispatchEvent(new CustomEvent('le-appearance', { detail: LEX.appearance.state() })); } catch (e) {}
  }
  LEX.appearance = {
    skins: SKINS,
    skin: function () { var k = lsGetA('le-skin'); return SKINS.some(function (x) { return x.id === k; }) ? k : 'clear'; },
    mode: function () { var m = lsGetA('le-theme'); return m === 'light' || m === 'dark' ? m : 'auto'; },
    state: function () { return { skin: LEX.appearance.skin(), mode: LEX.appearance.mode(), dark: root.getAttribute('data-theme') === 'dark' }; },
    setSkin: function (id) {
      if (!SKINS.some(function (x) { return x.id === id; })) return;
      lsSetA('le-skin', id === 'clear' ? null : id);
      var apply = function () { if (id === 'clear') root.removeAttribute('data-skin'); else root.setAttribute('data-skin', id); apChanged(); };
      var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (document.startViewTransition && !calm) document.startViewTransition(apply); else apply();
    },
    setMode: function (m) {
      if (m !== 'light' && m !== 'dark') m = 'auto';
      lsSetA('le-theme', m === 'auto' ? null : m); lsSetA('it-theme', null);
      root.setAttribute('data-theme', m === 'auto' ? (systemDark() ? 'dark' : 'light') : m);
      apChanged();
    },
    onChange: function (fn) { aplisteners.push(fn); },
    /* The picker, the studio section and the sheet load on first use (assets/js/le-appearance.js), off the blocking path. */
    load: function () {
      if (LEX.appearance._ready) return LEX.appearance._ready;
      LEX.appearance._ready = new Promise(function (res, rej) {
        var sc = document.createElement('script');
        sc.src = base() + 'assets/js/le-appearance.js';
        sc.onload = function () { res(LEX.appearance); };
        sc.onerror = function (e) { LEX.appearance._ready = null; rej(e); };
        document.head.appendChild(sc);
      });
      return LEX.appearance._ready;
    },
    section: function (c, body) {
      if (!c || !c.ui || !c.ui.section) return;
      var sec = c.ui.section('Appearance');
      var host = sec.querySelector('.sx-sec-body');
      host.innerHTML = '<div class="ap ap-loading" aria-busy="true"><span class="skel skel-row"></span><span class="skel skel-cards"></span></div>';
      body.insertBefore(sec, body.firstChild);
      LEX.appearance.load().then(function (A) { host.innerHTML = ''; host.appendChild(A.picker()); }).catch(function () { host.innerHTML = '<p class="ap-hint">Appearance could not load. Check the connection and open this panel again.</p>'; });
    },
    open: function () { LEX.appearance.load().then(function (A) { A.open(); }); }
  };
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var follow = function () { if (LEX.appearance.mode() === 'auto') { root.setAttribute('data-theme', systemDark() ? 'dark' : 'light'); apChanged(); } };
    if (mq.addEventListener) mq.addEventListener('change', follow); else if (mq.addListener) mq.addListener(follow);
  }

  var IT = window.IT = window.IT || {};

  IT.toast = function (msg, ms) {
    var el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.innerHTML = msg;
    el.classList.remove('is-done');
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2400);
  };

  IT.say = function (msg, ms) {
    var el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('is-done');
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2400);
  };

  /* A finished job (saved, downloaded, cleaned): the toast with a small check (styles: app.css, "Completion moments"). */
  IT.celebrate = function (msg, ms) {
    if (!msg) return;
    IT.say(msg, ms || 2800);
    var el = document.querySelector('.toast');
    if (!el) return;
    el.classList.remove('is-done');
    void el.offsetWidth;
    el.classList.add('is-done');
    clearTimeout(el._d);
    el._d = setTimeout(function () { el.classList.remove('is-done'); }, (ms || 2800) + 300);
  };

  IT.formatBytes = function (b) {
    if (b == null || isNaN(b)) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? (Math.round(b * 10) / 10) : Math.round(b)) + ' ' + u[i];
  };

  /* opts.quiet: the caller shows its own message (the studio says "Downloaded 1.5 MB" in its own toast). */
  IT.download = function (blobOrUrl, filename, opts) {
    var url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (typeof blobOrUrl !== 'string') setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    if (!(opts && opts.quiet)) IT.say('Download started');
  };

  IT.copy = function (text) {
    var done = function () { IT.say('Copied'); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done).catch(function () { IT.say('Could not copy'); });
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { IT.say('Press Ctrl+C to copy'); }
    ta.remove();
  };

  IT.dropzone = function (el, opts) {
    opts = opts || {};
    var input = el.querySelector('input[type=file]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      el.appendChild(input);
    }
    if (opts.accept) input.accept = opts.accept;
    if (opts.multiple) input.multiple = true;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    var emit = function (list) {
      var files = Array.prototype.slice.call(list || []);
      if (files.length && opts.onFiles) opts.onFiles(files);
    };
    el.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { emit(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (n) {
      el.addEventListener(n, function (e) { e.preventDefault(); el.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (n) {
      el.addEventListener(n, function (e) { e.preventDefault(); el.classList.remove('drag'); });
    });
    el.addEventListener('drop', function (e) { emit(e.dataTransfer && e.dataTransfer.files); });
    if (opts.paste) {
      document.addEventListener('paste', function (e) {
        var items = (e.clipboardData && e.clipboardData.files) || [];
        if (items.length) emit(items);
      });
    }
    return input;
  };

  IT.loadImage = function (file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('unreadable')); };
      img.src = url;
    });
  };

  IT.canvasToBlob = function (canvas, type, quality) {
    return new Promise(function (res) { canvas.toBlob(function (b) { res(b); }, type || 'image/png', quality); });
  };

  IT.baseName = function (name) { return (name || 'file').replace(/\.[^.]+$/, ''); };

  var TOOLS = [
    ['Photo studio', 'studio/', 'Layers, text, collages, filters, every social size'],
    ['PDF studio', 'pdf-studio/', 'Sign, fill, annotate, merge and reorder pages'],
    ['Convert to PDF', 'convert-to-pdf/', 'Word, Excel, PowerPoint, images and text to PDF'],
    ['Recipes', 'recipes/', 'Apply, edit and share a list of photo edits'],
    ['Image compressor', 'image-compressor/', 'Shrink a photo for the web or email'],
    ['Image resizer', 'image-resizer/', 'Change pixel size or use a social preset'],
    ['Image converter', 'image-converter/', 'JPG, PNG, WebP'],
    ['Crop', 'image-cropper/', 'Crop to a ratio or a free rectangle'],
    ['Rotate and flip', 'rotate-flip-image/', 'Turn or mirror a photo'],
    ['Filters', 'image-filters/', 'Brightness, contrast, and looks'],
    ['Watermark', 'watermark-image/', 'Stamp text or a logo'],
    ['Color palette', 'color-picker/', 'Pick colors from a photo'],
    ['Blur and sharpen', 'studio/?tool=blur', 'Soften or crisp a photo'],
    ['Background', 'studio/?tool=background', 'Crop, blur and dim a photo background'],
    ['Remove background', 'studio/?tool=cutout', 'Cut out a subject on this device (Beta)'],
    ['Redact', 'studio/?tool=redact', 'Box, pixelate or blur faces and text'],
    ['Collage', 'studio/?tool=collage', 'Arrange several photos'],
    ['Meme', 'studio/?tool=meme', 'Top and bottom captions'],
    ['Text', 'studio/?tool=text', 'Add words to a photo'],
    ['Frames', 'studio/?tool=frame', 'Border, padding, rounded corners'],
    ['Upscale', 'studio/?tool=upscale', 'Enlarge with sharpening'],
    ['Batch', 'studio/?tool=batch', 'Resize and export many photos'],
    ['Metadata', 'studio/?tool=metadata', 'Read or drop camera data'],
    ['Photo privacy check', 'photo-privacy/', 'What a photo reveals, removed in one tap'],
    ['Compare', 'studio/?tool=compare', 'Before and after'],
    ['Merge PDF', 'merge-pdf/', 'Combine PDFs'],
    ['Split PDF', 'split-pdf/', 'Extract pages'],
    ['JPG to PDF', 'jpg-to-pdf/', 'Images into one PDF'],
    ['PDF to JPG', 'pdf-to-jpg/', 'Each page as an image'],
    ['Rotate PDF', 'rotate-pdf/', 'Turn PDF pages'],
    ['Organize PDF', 'organize-pdf/', 'Reorder pages'],
    ['Page numbers', 'add-page-numbers/', 'Number PDF pages'],
    ['Watermark PDF', 'watermark-pdf/', 'Stamp a PDF'],
    ['Word counter', 'word-counter/', 'Count words and reading time'],
    ['Case converter', 'case-converter/', 'Change text case'],
    ['Text compare', 'text-diff/', 'See what changed'],
    ['QR code', 'qr-code-generator/', 'Make a QR code'],
    ['Password', 'password-generator/', 'Make a password'],
    ['JSON', 'json-formatter/', 'Format JSON'],
    ['Base64', 'base64-encoder/', 'Encode or decode'],
    ['Hash', 'hash-generator/', 'MD5 and SHA'],
    ['Units', 'unit-converter/', 'Convert units'],
    ['Color converter', 'color-converter/', 'HEX, RGB, HSL'],
    ['UUID', 'uuid-generator/', 'Generate IDs'],
    ['Favicon', 'favicon-generator/', 'App icons from an image'],
    ['Lorem ipsum', 'lorem-ipsum-generator/', 'Placeholder text'],
    ['Image to Base64', 'image-to-base64/', 'Data URLs'],
    ['Device check', 'device-check/', 'What works on this device and browser'],
    ['Verify a file', 'verify/', 'Check that a file matches its fingerprint'],
    ['Privacy and install', 'about/', 'How LocalEditor keeps files on this device']
  ];

  /* Category hubs and feature pages: [title, href, tagline, icon or keywords]. Only live and beta entries. */
  /* BEGIN site index */
  var HUBS = [["Photo and design","photo/","Edit photos, make collages and posts","image"],["PDF and documents","pdf/","Sign, fill, merge and convert PDFs","pdf"],["Expert mode","expert/","Colour grading, RAW, retouching, effects and relighting","sliders"],["Photographers","photographers/","RAW, HDR, grading, retouching and relighting","camera"],["Social and creators","social/","Posts, stories and collages for every platform","sizes"],["Online sellers","sellers/","Product photos, catalogues, labels and pay posters","shop"],["Small business","business/","Brand kit, product photos and signed PDFs","shop"],["Office work","office/","Confidential PDFs: sign, merge, watermark","briefcase"],["Teachers","teachers/","Worksheets, forms and classroom displays","school"],["Privacy tools","privacy-tools/","Check photos and PDFs before you share them","shield"],["For AI agents","ai-agents/","Agent mode, command line, formats and guides","code"],["Every tool","tools/","Every single-step tool on one page","grid"]];
  var PAGES = [["Collage maker","collage-maker/","Layouts and styles with a slot for every photo","collage photo grid moodboard scrapbook photo collage instant print wall"],["Photo backgrounds","photo-backgrounds/","Crop, blur and dim a photo behind your design","background blur background dim wallpaper backdrop blur photo background dim photo photo background"],["Recipes and batch editing","batch-edit/","One look, applied to many photos","batch bulk edit preset filter recipe expert look look grade preset"],["Sizes for every platform","social-media-sizes/","Instagram, story, YouTube and more, ready to go","instagram size story size youtube thumbnail size resize aspect ratio social media sizes resize photo photo size"],["Photo editor","photo-editor/","Crop, light, colour and filters","photo editor crop brightness contrast filters edit photo online crop photo brighten photo fix dark photo black and white photo"],["Text and fonts","add-text-to-photo/","Titles and captions in dozens of typefaces","add text to photo fonts caption title typography text on image"],["Brand kit","brand-kit/","Your colours, fonts and logos in every design","brand kit brand colors logo style guide brand fonts brand colours"],["PDF studio","pdf-editor/","Sign, fill, annotate and reorder pages","sign pdf fill pdf pdf editor annotate pdf edit pdf pdf form fill pdf form"],["Convert to PDF","word-to-pdf/","Office files, images and text into PDFs","word to pdf docx to pdf excel to pdf powerpoint to pdf convert to pdf"],["Install and offline use","install/","Home screen app that works offline","install pwa offline home screen app"],["Storage manager","storage-manager/","What the app keeps here, and a clear button","storage cache clear data space offline files clear cache free up space delete saved data"],["Background remover","background-remover/","Cut out one clear subject on this device, with a brush for touch-ups","remove background background remover cut out transparent png cutout remove bg transparent background cut out person"],["Thumbnail maker","thumbnail-maker/","A cut-out, a bold headline and eight layouts at 1280 × 720","youtube thumbnail thumbnail maker video thumbnail cover image"],["Export for every size","export-every-size/","Tick the sizes you need, get one zip","export all sizes zip share resize for every platform"],["Carousel maker","carousel-maker/","One wide design, split into slides that line up","carousel instagram carousel seamless slides swipe"],["Process replay","process-replay/","The making of a design, as a short video","timelapse process video replay speed art making of"],["Template links","template-links/","Layout and text in a link; photos stay home","template share link remix share design"],["Open design file format","open-design-format/","Readable design files for people and agents","design format json ai agent ledesign design file open format"],["Quick makers","quick-makers/","A short form in, an editable design out","maker generator template form quick makers poster maker invitation maker card maker design from a form"],["PDF redaction","redact-pdf/","Removes what is under the boxes, then verifies","redact pdf black out remove text redaction hide information black out pdf hide text in pdf"],["What does this PDF reveal?","pdf-reveal/","Author, comments, attachments and hidden text","pdf metadata hidden data author pdf properties strip metadata"],["Is this PDF safe to open?","pdf-safety-check/","Looks for scripts, automatic actions and attached programs","pdf javascript malicious pdf safe suspicious pdf embedded files"],["Safe to send","safe-to-send/","Clean a PDF in one step before it leaves your hands","flatten pdf clean pdf send sanitize pdf remove metadata"],["Find sensitive data","find-sensitive-data/","Emails, phone and ID numbers, found for you","pii personal data find email sensitive data find phone numbers"],["Password-protect a PDF","password-protect-pdf/","Add a password to PDFs, or take one off","password pdf encrypt pdf unlock pdf protect pdf aes-256"],["Mail-merge PDFs","pdf-mail-merge/","A spreadsheet in, one PDF per person out","mail merge bulk pdf payslips certificates personalised pdf pdf mail merge"],["Split by text","split-pdf-by-text/","One file per employee or student","split pdf by name bulk split split pdf by text one pdf per employee"],["Per-recipient watermarks","bulk-pdf-watermarks/","One named copy per recipient","watermark leak confidential per recipient trace"],["Compress to a target size","compress-pdf/","“Under 2 MB” in one step","compress pdf reduce pdf size pdf under 2mb email pdf"],["Searchable scans","searchable-pdf/","On-device text recognition for scans","ocr searchable pdf scan to text make scanned pdf searchable read text in scan copy text from scan image to text text recognition"],["Camera scan","scan-to-pdf/","Straightened, cleaned and saved as PDF","scan scan to pdf camera scanner document scanner phone scanner scan document with phone photo to pdf straighten page"],["Colour grading","colour-grading/","Curves, hue bands, colour wheels and LUTs","colour grading color grading color correction colour correction curves tone curve lut cube lut colour wheels hsl white balance teal and orange colorist grade photo change colours fix colours"],["Film and creative effects","creative-effects/","Film grain, bloom, lens blur and light leaks","film grain make photo look like film film look analog vintage photo halation bloom glow lens blur blur background tilt shift vignette light leak dust and scratches sharpen dehaze noise reduction duotone halftone glitch oil paint sketch bokeh soft focus photo effects"],["Product shadows and reflections","product-shadows/","Contact and cast shadows, reflections, clean edges","product photo product photography shadow drop shadow add shadow to photo reflection floor reflection mirror reflection packshot contact shadow cast shadow ecommerce online shop sell online product staging white background product"],["Compositing and blend modes","compositing/","Blend modes, masks, match colour and light wrap","blend modes multiply screen overlay layer blending layers mask layer mask composite compositing combine photos merge photos double exposure match colour light wrap mesh warp adjustment layer"],["Portrait retouching","portrait-retouching/","Frequency separation, blemishes, skin, dodge and burn","retouch portrait retouching skin smoothing remove spots remove blemishes blemish pimples heal clone frequency separation dodge and burn red eye teeth whitening under eye shine remove dust smooth skin fix skin touch up"],["Liquify and reshape","liquify/","Brush reshaping and face-aware liquify","liquify reshape warp push pixels slim face slimming smile nose jaw face reshape bend distort twirl"],["Camera RAW develop","raw-develop/","Open camera RAW files and develop them","raw raw photo camera raw raw editor develop raw open raw files dng cr2 cr3 nef arw raf raw converter exposure white balance highlights lens correction"],["HDR merge","hdr-merge/","Merge two to nine exposures into one","hdr hdr merge merge exposures bracketing exposure fusion combine exposures tone mapping real estate photo landscape photo ghost removal bracketed photos"],["Relight and depth effects","relight/","Add lights, rim light, light rays and depth fog","relight add light change lighting lighting rim light light rays god rays depth map fog haze catchlight blur background depth blur backlight fill light portrait lighting"],["Embed a design","embed-a-design/","A read-only design on any page, with a button to edit","embed iframe embed code blog docs page show design on a website read only viewer widget"],["Brand file","brand-file/","Colours, fonts and logos in a file a person or an agent can read","brand file lebrand brand guidelines brand json brand colours brand check style guide"],["Design as code","design-as-code/","Build, check and compare designs like source files","design as code build design design diff ci github action pull request design review dsl builder"],["Agent mode","agent-mode/","Watch an agent edit live, and step in at any time","ai agent agent mode ai assistant coding agent let ai edit ai design watch ai edit automate design llm chatbot design"],["Command line and MCP","agent-cli/","Command line, MCP server and local API","command line cli mcp mcp server terminal headless api automation script design render design local api"],["Font library","font-library/","257 families and 20 originals, loaded only when used","fonts font library typefaces free fonts handwriting font serif sans serif font pairing script fonts display fonts download fonts"],["Themes and appearance","themes/","Five themes, light, dark or automatic","dark mode light mode theme appearance high contrast accessibility large text night mode"],["Fill-in templates and bulk create","bulk-create/","A spreadsheet in, finished designs out","bulk create mail merge certificates name badges name tags price tags place cards spreadsheet csv excel batch labels tickets vouchers many at once class awards"],["Screenshot beautifier","screenshot-beautifier/","A framed screenshot or code image on a soft backdrop","screenshot beautify screenshot screenshot mockup code image code screenshot code snippet browser mockup phone mockup frame screenshot share code pretty screenshot"],["Photobooth strip","photobooth-strip/","A strip, grid or wide strip, from your camera or photos","photobooth photo booth photo strip wedding photo booth party photos selfie strip four photo strip print strip 2x6 countdown camera"],["Recap collage","recap-collage/","Up to 30 photos, a title, dates and a line of stats","recap photo dump weekly recap month in photos year in review trip recap photo collage highlights summer recap photo grid"],["Catalogue and price list maker","catalogue-maker/","Product pages, price lists and menus from a spreadsheet","catalogue catalog price list menu product list line sheet spreadsheet to pdf csv to catalogue restaurant menu cafe menu market stall product catalogue price sheet"],["QR signs and posters","qr-posters/","Wi-Fi sign, pay poster and invitation with a code","wifi sign wifi qr code guest wifi scan to pay upi qr payment qr qr poster qr code sign rsvp qr invitation qr cafe sign shop counter"],["Printables","printables/","Calendars, charts, labels, stickers, photo books and zines","printable calendar planner weekly planner chore chart reward chart sticker sheet labels gift tags photo book zine mini zine print at home worksheet"],["Flyer maker","flyer-maker/","Flyers for print and social, with an optional QR code","leaflet poster event flyer sale handout a5 qr code"],["CV maker","resume-maker/","A one-page CV or résumé, saved as a PDF","cv resume résumé curriculum vitae job application one page"],["Greeting card maker","greeting-card-maker/","Folded or flat cards for thanks, birthdays and congratulations","thank you card birthday card congratulations folded card holiday card note card"],["Certificate maker","certificate-maker/","Award and completion certificates, one or one per name","award certificate diploma completion participation attendance class award employee of the month from a list"],["Business card maker","business-card-maker/","Front and back with bleed, a QR contact card and a print sheet","visiting card name card contact card vcard qr bleed double sided spreadsheet"],["ID badge maker","id-badge-maker/","Staff, visitor, student and event badges, one or many","id card staff badge visitor pass student id event badge lanyard photo id conference"],["Letterhead maker","letterhead-maker/","A4 or Letter letterhead, compliment slip and envelope","letter template stationery compliment slip envelope headed paper mail merge"],["Gift voucher maker","gift-voucher-maker/","Gift vouchers and coupons with a code, one or a numbered run","gift certificate gift card coupon discount voucher code salon"],["Ticket maker","ticket-maker/","Event tickets with a stub, a number and a QR code","event ticket raffle tickets numbered tickets concert school play admission stub"],["Loyalty card maker","loyalty-card-maker/","Stamp cards with 5, 8 or 10 stamps and a reward","stamp card punch card reward card coffee card cafe salon"],["Compare two PDFs","compare-pdfs/","Every changed word, amount and date, plus a picture view","compare pdf pdf diff find differences between pdfs compare documents redline version compare what changed compare contracts"],["Build a PDF pack","pdf-bundle/","A cover, contents, bookmarks and page numbers","merge pdf with cover combine pdfs table of contents bates numbering bookmarks document pack bundle court bundle client pack board pack"],["Stamps and comment summary","pdf-stamps/","Office stamps with name and date, and a comment list","pdf stamp approved stamp paid stamp received stamp initial every page date stamp pdf comment summary list comments pdf draft stamp"],["Saved PDF workflows","pdf-workflows/","Number, watermark, compress and protect in one go","pdf workflow batch pdf automate pdf repeat pdf steps pdf recipe number and watermark pdf lepdfworkflow"],["Fingerprint receipt","fingerprint-receipt/","A code anyone can use to check a copy is unchanged","fingerprint checksum sha-256 verify file file integrity is this the same file receipt tamper check document integrity"],["Fill forms from saved details","fill-forms-from-saved-details/","Save your details once, fill any form from them","autofill pdf fill pdf form saved details fill forms fast repeat form filling address on forms my details"],["Invoices, quotes and receipts","invoice-maker/","Invoices, quotes, receipts and credit notes as PDFs","invoice invoice maker quote estimate receipt credit note make an invoice free invoice generator gst invoice vat invoice small business invoice freelance invoice"],["PDF tables to a spreadsheet","pdf-tables-to-excel/","Find tables in a PDF and save them as Excel or CSV","pdf to excel pdf to csv extract table from pdf pdf table bank statement to excel convert pdf to spreadsheet pdf to xlsx"],["Meme maker","studio/?tool=meme","Top and bottom captions on any photo","meme caption"],["Frames and borders","studio/?tool=frame","Border, padding and rounded corners","frame border"],["Upscale","studio/?tool=upscale","Enlarge a photo with sharpening","upscale enlarge enlarge photo make photo bigger"],["Before and after","studio/?tool=compare","Side-by-side comparison image","before after compare"],["Photo metadata","studio/?tool=metadata","Read or drop camera data and location","exif metadata gps location remove exif remove location from photo"],["Redact a photo","studio/?tool=redact","Box, pixelate or blur faces, plates, names and numbers","redact blur face pixelate hide blur license plate cover text"],["Quote cards","studio/?make=quote","A quote and who said it, in five styles","quote quote card saying poem lyrics"],["Review cards","studio/?make=review","A customer review with stars, in five styles","review testimonial customer review stars"],["Receipt-style lists","studio/?make=receipt","A year, a trip or a week as a receipt, ticket or ledger","receipt year in review recap list"],["Milestone cards","studio/?make=milestone","“6 months today” for a baby, pet, couple or work","milestone baby anniversary months old"],["Palette poster","studio/?make=palette","The colours of a photo, as a poster with hex codes","palette colours hex swatches"],["Film camera looks","studio/?make=film","Your photo on 35mm, an instant print or a disposable","film 35mm date stamp disposable camera instant print"],["Agent guide","docs/AGENT-GUIDE.md","Read once before driving the studio","agent guide llm instructions for ai agent documentation"],["llms.txt","llms.txt","A plain-text summary of the site for language models","llms.txt llm language model ai summary"],["Agent kit","agent-kit/README.md","Drop-in instruction files for coding agents","agent kit agents.md agent rules skill file mcp config"],["Design file schema","schema/design-1.json","The JSON Schema for .ledesign.json","json schema ledesign design file schema"],["Design file format","docs/FORMAT-DESIGN.md","Every field of a design file, in plain words","design file format ledesign open format"],["Recipe and PDF workflow formats","docs/FORMAT-WORKFLOW.md","Share a photo look or a PDF job as a small file","leworkflow recipe format pdf workflow format lepdfworkflow"],["Open-source licences","licenses/","Every third-party component, with its licence and source","licences licenses open source third party attribution"],["Movie poster","studio/?make=movieposter","A trip or an event as a film poster","movie poster film poster cinema trip poster holiday poster starring credits"],["Album cover","studio/?make=albumcover","A photo, an artist and a title as a square cover","album cover single cover playlist cover mixtape music artwork cover art"],["Newspaper front page","studio/?make=frontpage","Your news as a front page","newspaper front page headline birth announcement wedding announcement graduation retirement"],["Event kit","studio/?make=eventkit","An invitation, story, banner and name tags that match","event invitation name tag badge banner meetup party workshop"],["Invitation with QR code","studio/?make=qrinvite","An invitation with a code for RSVPs, the map or the address","invitation invite rsvp wedding invitation birthday invitation baby shower housewarming save the date"],["Wi-Fi sign","studio/?make=wifisign","A sign with a code that joins your Wi-Fi","wifi wi-fi sign guest wifi wifi password wifi qr code table tent cafe sign"],["Scan-to-pay poster","studio/?make=payposter","A counter poster with a UPI or payment-link code","scan to pay upi payment qr pay poster shop counter donation tip jar"],["App store screenshots","studio/?make=appshots","A headline over each screen in a simple device frame","app store screenshots store listing app screenshots device mockup app launch"],["Link card and banner","studio/?make=linkcard","A social preview card or a project banner","link preview social card open graph image readme banner repository banner blog header"],["Calendar and planner","studio/?make=calendar","A month for the fridge or a week to plan, ready to print","calendar printable calendar monthly planner weekly planner family calendar school calendar"],["Chore and reward charts","studio/?make=chart","Jobs with tick boxes, or stars to fill, one page per child","chore chart reward chart sticker chart behaviour chart kids routine star chart"],["Labels and gift tags","studio/?make=labels","A sheet of labels or gift tags with a punch hole","labels gift tags jar labels name labels school labels pantry labels label sheet"],["Sticker sheets","studio/?make=stickers","Short words and emoji as stickers with cut lines","stickers sticker sheet reward stickers planner stickers teacher stickers well done"],["Photo book","studio/?make=photobook","A cover, photo pages with captions and a back cover","photo book photobook photo album yearbook holiday album booklet scrapbook"],["Mini zine","studio/?make=zine","Eight little pages on one sheet: fold, cut once, read","zine mini zine one page zine pocket book class project fold booklet"]];
  /* END site index */

  function base() {
    return root.getAttribute('data-root') || '';
  }

  function here() {
    var path = location.pathname.replace(/\/index\.html$/, '/');
    var bits = path.split('/').filter(Boolean);
    return bits[bits.length - 1] || '';
  }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  var ICONS = {
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
    studio: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
    recipes: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M8 12h8M8 16h5"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.4"/><path d="m21 15-4.2-4.2a1.5 1.5 0 0 0-2.1 0L7 18"/>',
    pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    office: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    crop: '<path d="M6 3v14a2 2 0 0 0 2 2h13"/><path d="M18 21V8a2 2 0 0 0-2-2H3"/>',
    resize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    filters: '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="15" r="5.5"/>',
    background: '<path d="M12 3a9 9 0 1 0 0 18z" fill="currentColor" fill-opacity=".25"/><circle cx="12" cy="12" r="9"/>',
    collage: '<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    storage: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    merge: '<path d="M8 6h10a2 2 0 0 1 2 2v12"/><rect x="2" y="2" width="12" height="16" rx="2"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
    pdfstudio: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="m9.5 17 4.8-4.8a1.3 1.3 0 0 1 1.8 1.8L11.3 18.8 9 19.3z"/>',
    convert: '<path d="M4 7h11l-3-3M20 17H9l3 3"/><path d="M17 4h3v6M7 20H4v-6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
    sizes: '<rect x="3" y="7" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="18" rx="1.5"/>',
    shop: '<path d="M4 9h16l-1.2 10.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/>',
    school: '<path d="M2 9.5 12 5l10 4.5-10 4.5z"/><path d="M6 11.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.5M22 9.5V15"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>'
  };

  function mark() {
    return '<span class="le-mark" aria-hidden="true"><svg viewBox="0 0 512 512"><path d="M256 0C51 0 0 51 0 256s51 256 256 256 256-51 256-256S461 0 256 0z" fill="#0369DA"/><path d="M176 140v196a40 40 0 0 0 40 40h156" fill="none" stroke="#fff" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/><circle cx="314" cy="236" r="58" fill="#EF8C57"/></svg></span>';
  }

  function isCurrent(href) {
    var slug = here();
    if (href.indexOf('?') >= 0 || href.indexOf('#') >= 0) return false;
    var s = href.replace(/\/$/, '');
    return s ? s === slug : !slug;
  }

  /* The drawer: the whole menu, at every width. */
  function sideHTML() {
    var b = base();
    function item(href, name, ic, note) {
      return '<a class="item" href="' + b + href + '"' + (isCurrent(href) ? ' aria-current="page"' : '') + '>' + icon(ICONS[ic] || ICONS.image) + '<span>' + name + '</span>' + (note ? '<small>' + note + '</small>' : '') + '</a>';
    }
    return '' +
      '<div class="le-side-head">' +
        '<a class="le-brand" href="' + (b || './') + '">' + mark() + '<span><strong>LocalEditor</strong><em>Private design studio</em></span></a>' +
        '<button class="le-icon" type="button" data-menu-close aria-label="Close menu">' + icon(ICONS.close) + '</button>' +
      '</div>' +
      '<nav class="le-nav" aria-label="All sections">' +
        '<div class="le-label">Studios</div>' +
        item('', 'Home', 'home') +
        item('studio/', 'Photo studio', 'studio') +
        item('pdf-studio/', 'PDF studio', 'pdfstudio') +
        item('convert-to-pdf/', 'Convert to PDF', 'convert') +
        item('recipes/', 'Recipes', 'recipes') +
        (HUBS.length ? '<div class="le-label">Browse by need</div>' + HUBS.map(function (h) { return item(h[1], h[0], h[3]); }).join('') : item('#tools', 'Every tool', 'grid')) +
        '<div class="le-promise">' + icon(ICONS.shield) + '<span><strong>Nothing is uploaded</strong>Your photos and PDFs are edited by this browser and stay on this device.</span></div>' +
      '</nav>' +
      '<div class="le-side-foot">' +
        '<button type="button" class="le-row" data-le-install>' + icon(ICONS.download) + '<span>Install app</span><small>Works offline</small></button>' +
        '<button type="button" class="le-row" data-le-storage>' + icon(ICONS.storage) + '<span>Storage on this device</span></button>' +
        '<button type="button" class="le-row" data-appearance>' + icon(ICONS.moon) + '<span>Appearance</span><small data-ap-label></small></button>' +
        '<a class="le-row" href="' + b + 'about/">' + icon(ICONS.info) + '<span>Privacy and about</span></a>' +
      '</div>';
  }

  /* The header: brand, sections, search, theme, menu and the one primary action. */
  function topHTML() {
    var b = base();
    function link(href, name) {
      return '<a href="' + b + href + '"' + (isCurrent(href) ? ' aria-current="page"' : '') + '>' + name + '</a>';
    }
    return '' +
      '<a class="le-brand" href="' + (b || './') + '" aria-label="LocalEditor home">' + mark() + '<span><strong>LocalEditor</strong></span></a>' +
      '<nav class="le-links" aria-label="Sections">' +
        link('studio/', 'Photo studio') +
        link('pdf-studio/', 'PDF studio') +
        link('convert-to-pdf/', 'Convert') +
        link('recipes/', 'Recipes') +
        link(HUBS.some(function (h) { return h[1] === 'tools/'; }) ? 'tools/' : '#tools', 'All tools') +
      '</nav>' +
      '<span class="spacer"></span>' +
      '<button class="le-search" type="button" data-search aria-label="Search tools">' + icon(ICONS.search) + '<span>Search tools</span><kbd>/</kbd></button>' +
      '<button class="le-icon" type="button" data-appearance aria-label="Appearance" aria-haspopup="dialog"><span class="le-theme-icon-light">' + icon(ICONS.moon) + '</span><span class="le-theme-icon-dark">' + icon(ICONS.sun) + '</span></button>' +
      '<button class="le-icon le-menu" type="button" data-menu aria-label="Open menu" aria-expanded="false" aria-controls="le-drawer">' + icon(ICONS.menu) + '</button>' +
      '<a class="btn btn-gold btn-sm le-cta" href="' + b + 'studio/">Open studio</a>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function syncTheme() {
    var dark = root.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      if (b.classList.contains('le-icon')) b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    });
    document.querySelectorAll('[data-theme-label]').forEach(function (s) { s.textContent = dark ? 'Light theme' : 'Dark theme'; });
    document.querySelectorAll('[data-ap-label]').forEach(function (s) { var st = LE.appearance.state(); s.textContent = (LE.appearance.skins.filter(function (k) { return k.id === st.skin; })[0] || {}).name + ' · ' + (st.mode === 'auto' ? 'Auto' : dark ? 'Dark' : 'Light'); });
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) {
      var cs = getComputedStyle(root), studio = document.body.classList.contains('sx-body') || document.body.classList.contains('ps-body');
      var c = (studio ? cs.getPropertyValue('--side') : (cs.getPropertyValue('--bar-solid') || cs.getPropertyValue('--bg'))).trim();
      if (c) meta.setAttribute('content', c);
    }
  }

  function mountShell() {
    var sideSlot = document.querySelector('.le-side[data-fill]');
    var topSlot = document.querySelector('.le-top[data-fill]');
    if (sideSlot) { sideSlot.innerHTML = sideHTML(); sideSlot.id = sideSlot.id || 'le-drawer'; }
    if (topSlot) topSlot.innerHTML = topHTML();
    if (document.body.classList.contains('le-built') || document.querySelector('.le-app')) { afterMount(); return; }
    var main = document.getElementById('main');
    if (!main) return;
    var app = document.createElement('div');
    app.className = 'le-app';
    var side = document.createElement('aside');
    side.className = 'le-side';
    side.id = 'le-drawer';
    side.setAttribute('aria-label', 'Menu');
    side.innerHTML = sideHTML();
    var wrap = document.createElement('div');
    wrap.className = 'le-main';
    var top = document.createElement('header');
    top.className = 'le-top';
    top.innerHTML = topHTML();
    var content = document.createElement('div');
    content.className = 'le-content';
    var scrim = document.createElement('button');
    scrim.className = 'le-scrim';
    scrim.type = 'button';
    scrim.hidden = true;
    scrim.tabIndex = -1;
    scrim.setAttribute('data-scrim', '');
    scrim.setAttribute('aria-label', 'Close menu');
    var skip = document.querySelector('.skip');
    if (skip && skip.nextSibling) document.body.insertBefore(app, skip.nextSibling);
    else document.body.insertBefore(app, document.body.firstChild);
    app.appendChild(wrap);
    wrap.appendChild(top);
    wrap.appendChild(content);
    content.appendChild(main);
    var footer = document.querySelector('.site-footer');
    if (footer) content.appendChild(footer);
    app.appendChild(side);
    document.body.appendChild(scrim);
    afterMount();
  }

  function afterMount() {
    syncTheme();
    initDirectory();
    /* app.js sets a fixed theme-color after mounting; correct it once that has run. */
    setTimeout(syncTheme, 0);
  }

  var lastFocus = null;
  function setMenu(open) {
    var side = document.querySelector('.le-side');
    if (open === document.body.classList.contains('le-menu-open')) return;
    document.body.classList.toggle('le-menu-open', open);
    var scrim = document.querySelector('[data-scrim]');
    if (scrim) scrim.hidden = !open;
    document.querySelectorAll('[data-menu]').forEach(function (btn) { btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    if (open) {
      lastFocus = document.activeElement;
      var first = side && (side.querySelector('[aria-current="page"]') || side.querySelector('a, button'));
      if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 30);
    } else if (lastFocus && lastFocus.focus) {
      lastFocus.focus({ preventScroll: true });
      lastFocus = null;
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu]')) { setMenu(!document.body.classList.contains('le-menu-open')); return; }
    if (e.target.closest('[data-scrim], [data-menu-close]')) { setMenu(false); return; }
    if (e.target.closest('.le-nav a')) setMenu(false);

    var themeBtn = e.target.closest('[data-theme-toggle]');
    if (themeBtn) {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('le-theme', next); } catch (err) {}
      syncTheme();
      return;
    }
    if (e.target.closest('[data-appearance]')) { setMenu(false); LE.appearance.open(); return; }

    if (e.target.closest('[data-search]')) openSearch();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setMenu(false);
    if (e.key === 'Tab' && document.body.classList.contains('le-menu-open')) {
      var side = document.querySelector('.le-side');
      var items = side ? [].slice.call(side.querySelectorAll('a[href], button:not([disabled])')).filter(function (el) { return el.offsetParent !== null; }) : [];
      if (items.length) {
        var firstEl = items[0], lastEl = items[items.length - 1];
        if (!side.contains(document.activeElement)) { e.preventDefault(); firstEl.focus(); }
        else if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    }
    var tag = (e.target && e.target.tagName) || '';
    var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
      e.preventDefault();
      openSearch();
    }
  });

  /* Homepage tool directory: [data-tool-dir] holds a search field, category chips and groups of links. */
  function initDirectory() {
    var dir = document.querySelector('[data-tool-dir]');
    if (!dir || dir._le) return;
    dir._le = true;
    var input = dir.querySelector('[data-dir-search]');
    var chips = [].slice.call(dir.querySelectorAll('[data-dir-cat]'));
    var groups = [].slice.call(dir.querySelectorAll('[data-dir-group]'));
    var empty = dir.querySelector('[data-dir-empty]');
    var status = dir.querySelector('[data-dir-status]');
    var cat = 'all';
    function apply() {
      var words = (input ? input.value : '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      var total = 0;
      groups.forEach(function (g) {
        var inCat = cat === 'all' || g.getAttribute('data-dir-group') === cat;
        var n = 0;
        [].slice.call(g.querySelectorAll('li')).forEach(function (li) {
          var a = li.querySelector('[data-k]');
          var hay = a ? a.getAttribute('data-k') : '';
          var ok = inCat && words.every(function (w) { return hay.indexOf(w) >= 0; });
          li.hidden = !ok;
          if (ok) n++;
        });
        g.hidden = n === 0;
        var count = g.querySelector('.hp-dir-label span');
        if (count) count.textContent = n;
        total += n;
      });
      if (empty) {
        empty.hidden = total > 0;
        var q = empty.querySelector('[data-dir-query]');
        if (q) q.textContent = input ? input.value.trim() : '';
      }
      if (status) status.textContent = total + (total === 1 ? ' tool' : ' tools') + ' shown';
    }
    if (input) input.addEventListener('input', apply);
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        cat = c.getAttribute('data-dir-cat');
        chips.forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
        apply();
      });
    });
    apply();
  }

  var dialog;
  function openSearch() {
    setMenu(false);
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'le-dialog';
      dialog.setAttribute('aria-label', 'Search tools');
      dialog.innerHTML = '<form method="dialog"><input type="search" placeholder="Search tools, topics and studios" aria-label="Search tools" autocomplete="off" enterkeyhint="go"><ul></ul><p class="empty-search hidden">No tools match.</p></form>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
      var input = dialog.querySelector('input');
      input.addEventListener('input', function () { paintSearch(input.value); });
      input.addEventListener('keydown', function (e) {
        var links = [].slice.call(dialog.querySelectorAll('a'));
        var i = links.findIndex(function (a) { return a.getAttribute('aria-selected') === 'true'; });
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!links.length) return;
          if (i >= 0) links[i].removeAttribute('aria-selected');
          i = e.key === 'ArrowDown' ? Math.min(links.length - 1, i + 1) : Math.max(0, i - 1);
          links[i].setAttribute('aria-selected', 'true');
          links[i].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (i < 0 && links.length) i = 0;
          if (i >= 0) links[i].click();
        }
      });
    }
    paintSearch('');
    dialog.showModal();
    dialog.querySelector('input').value = '';
    dialog.querySelector('input').focus();
  }

  function paintSearch(q) {
    var words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var ul = dialog.querySelector('ul');
    var empty = dialog.querySelector('.empty-search');
    var b = base();
    var html = '';
    var n = 0;
    /* Hubs first, then tools, then feature guides. A feature page's keywords are searched but not shown. */
    var all = HUBS.map(function (h) { return [h[0], h[1], 'Category · ' + h[2], '']; })
      .concat(TOOLS.map(function (t) { return [t[0], t[1], t[2], '']; }))
      .concat(PAGES.map(function (p) { return [p[0], p[1], p[2], p[3]]; }));
    all.forEach(function (t) {
      var hay = (t[0] + ' ' + t[2] + ' ' + t[1] + ' ' + t[3]).toLowerCase();
      if (words.length && !words.every(function (w) { return hay.indexOf(w) >= 0; })) return;
      n++;
      html += '<li><a href="' + b + t[1] + '">' + escapeHtml(t[0]) + '<span>' + escapeHtml(t[2]) + '</span></a></li>';
    });
    ul.innerHTML = html;
    empty.classList.toggle('hidden', n > 0);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(base() + 'sw.js', { scope: base() || './' }).catch(function () {});
    });
  }

  window.addEventListener('offline', function () { IT.say('You are offline. Tools on this device keep working.'); });

  mountShell();

  LE.appearance.onChange(syncTheme);
  syncTheme();
  /* Large title that collapses into the bar: when the page's title scrolls away, its words appear in the top bar. */
  (function () {
    var h1 = document.querySelector('.pg-hero h1, .hero h1, .page-intro h1, main > section h1');
    var bar = document.querySelector('.le-top');
    if (!h1 || !bar || !window.IntersectionObserver || document.querySelector('.hp-hero')) return;
    var t = document.createElement('span');
    t.className = 'le-top-title'; t.setAttribute('aria-hidden', 'true'); t.textContent = h1.textContent.replace(/\s+/g, ' ').trim();
    bar.appendChild(t);
    new IntersectionObserver(function (es) { bar.classList.toggle('is-titled', !es[0].isIntersecting); }, { rootMargin: '-64px 0px 0px 0px' }).observe(h1);
  })();
  /* On/off options on tool pages are switches (styled in app.css; Lapis keeps checkboxes). */
  document.querySelectorAll('.check > input[type="checkbox"]:not([role])').forEach(function (i) { i.setAttribute('role', 'switch'); });
})();

/* Light first load (docs/LOADING.md): the install, device-support and download code below is not needed for the first
   paint, so it loads after the load event when the main thread is idle, or at once when the address asks for it.
   window.__leLate(fn, urgent) runs fn then. */
(function () {
  'use strict';
  if (window.__leLate) return;
  var queue = [], ran = false;
  function run() { if (ran) return; ran = true; queue.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function go() { if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 400 }); else setTimeout(run, 150); }
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
  window.__leLate = function (fn, urgent) { if (urgent || ran) fn(); else queue.push(fn); };
  window.__leLate.now = run;
})();

/* Install, updates and storage manager: loads le-pwa.js and le-pwa.css on every page.
   The install prompt can fire before le-pwa.js arrives, so it is kept here until then. */
(function () {
  'use strict';
  if (window.__lePwaLoader) return;
  window.__lePwaLoader = true;
  var early = window.__lePwaEarly = { prompt: null, installed: false };
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); early.prompt = e; });
  window.addEventListener('appinstalled', function () { early.installed = true; early.prompt = null; });
  var base = document.documentElement.getAttribute('data-root') || '';
  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = base + 'assets/css/le-pwa.css';
    document.head.appendChild(css);
    var js = document.createElement('script');
    js.src = base + 'assets/js/le-pwa.js';
    js.async = true;
    document.head.appendChild(js);
  }
  /* Addresses that need it at once: ?install=, ?storage=1, #storage, a shared file. */
  var urgent = /[?&](install|storage|share-target|shared)=/.test(location.search) || location.hash === '#storage';
  window.__leLate(load, urgent);
  /* Install app or Storage tapped before it arrived: load it now and do what was asked. */
  window.addEventListener('click', function (e) {
    if (window.LEPwa || !e.target || !e.target.closest) return;
    var inst = e.target.closest('[data-le-install], .le-install, .install-btn'), st = !inst && e.target.closest('[data-le-storage]');
    if (!inst && !st) return;
    e.preventDefault();
    load();
    window.addEventListener('le-pwa-ready', function () { if (inst) window.LEPwa.install(); else window.LEPwa.openStorage(); }, { once: true });
  }, true);
})();

/* Device support checks (LE.support): loads le-support.js and le-support.css on every page. Features may push
   their definitions onto window.LE_SUPPORT_DEFS before it arrives. See docs/SUPPORT.md. */
(function () {
  'use strict';
  if (window.__leSupportLoader) return;
  window.__leSupportLoader = true;
  window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || [];
  var base = document.documentElement.getAttribute('data-root') || '';
  window.__leLate(function () {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = base + 'assets/css/le-support.css';
    document.head.appendChild(css);
    var js = document.createElement('script');
    js.src = base + 'assets/js/le-support.js';
    js.async = true;
    document.head.appendChild(js);
  });
})();

/* Download policy and packs (LE.downloads): loads le-downloads.js and le-downloads.css on every page. See docs/DOWNLOADS.md. */
(function () {
  'use strict';
  if (window.__leDownloadsLoader) return;
  window.__leDownloadsLoader = true;
  var base = document.documentElement.getAttribute('data-root') || '';
  window.__leLate(function () {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = base + 'assets/css/le-downloads.css';
    document.head.appendChild(css);
    var js = document.createElement('script');
    js.src = base + 'assets/js/le-downloads.js';
    js.async = true;
    document.head.appendChild(js);
  });
})();
