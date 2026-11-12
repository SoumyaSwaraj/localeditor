# LocalEditor

Private image studio and everyday tools. Editing runs in the browser. Files are not uploaded.

**Site:** https://localeditor.net/

## What's here

- `index.html` — homepage. `scripts/build.js` leaves this file alone when it contains `le-built`.
- `studio/` — the full editor (crop, color, text, recipes, export).
- `recipes/` — preview and share `.leworkflow` files.
- One page per existing tool under its own folder (compress, PDF, text, and the rest).
- `assets/css/app.css` and `assets/js/app.js` — design system and the shell those tool pages inherit.
- `assets/js/le-engine.js` — local image pipeline and recipe validation.
- `assets/vendor/` — pdf-lib, pdf.js, and the QR library, kept offline.
- `scripts/build.js` — regenerates about, 404, manifest, sitemap, robots, llms.txt, and the service worker.

## Develop

```bash
node scripts/build.js
python -m http.server 8000
```

Serve this folder as the site root. Production is a static upload to S3 behind CloudFront.

## Recipes

A `.leworkflow` file is JSON with `format` set to `localeditor-workflow`. Imported files are checked against a fixed list of operations. They cannot contain script.
