# Instant Tools

30 free, private, offline-capable browser tools for images, PDFs, text and developers.
Everything runs client-side — no uploads, no accounts. Installable as a PWA on Android, iOS and desktop.

**Live:** https://soumyaswaraj.github.io/instant-tools/

## Tools
- **Image:** compressor, resizer, converter, cropper, rotate & flip, watermark, image ↔ Base64, color picker & palette, favicon generator, photo filters
- **PDF:** merge, split, JPG → PDF, PDF → JPG, rotate, organize pages, add page numbers, watermark
- **Text:** word counter, case converter, text diff, lorem ipsum
- **Dev & utilities:** QR code generator, password generator, JSON formatter, Base64, hash generator (MD5/SHA), unit converter, color converter, UUID generator

## Structure
- `<slug>/index.html` — one self-contained page per tool (UI + logic + SEO/JSON-LD)
- `assets/css/app.css`, `assets/js/app.js` — shared design system and runtime (`window.IT` helpers, theme, install, SW)
- `assets/vendor/` — pdf-lib, pdf.js, qrcode-generator (vendored for offline use)
- `scripts/build.js` — generates `index.html`, `about/`, `404.html`, `manifest.webmanifest`, `sitemap.xml`, `robots.txt`, `llms.txt` and `sw.js` (precache list)

## Develop
```bash
node scripts/build.js   # re-run after adding/changing files so the service worker precaches them
python3 -m http.server 8000
```

## Deploy (GitHub Pages)
Settings → Pages → Deploy from branch → select the branch, folder `/ (root)`.
If you use a custom domain, update `SITE` in `scripts/build.js` and the canonical URLs in each tool page.
