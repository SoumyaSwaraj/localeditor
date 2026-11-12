# Collage templates + stock photos (round 4)

Local-first static PWA. No backend. API keys live only in `localStorage`. Do not commit secrets. Do not precache collage photos. Verify in the browser. Do not commit git.

## Why templates could not replace photos
Current `TEMPLATES` in `le-studio-panels.js` only overlay text/shapes on the existing page. They never create image layers. Replace already exists for selected image layers (`replaceImage` + toolbar). Fix: templates and collages create **photo slots**.

## Photo slots
Image layers may include:
```
slot: { id: 'a', label: 'Photo 1', photo: 'people-01' }
```
- `src` empty or missing → engine paints a dashed placeholder + “Add photo” (not a broken image).
- Click / double-click a slot, or toolbar **Replace image**, opens the replace picker: **Uploads | This device | Stock photos**.
- Replacing keeps crop, frame (border/radius), mask, rotation, shadow, tape, z-order.
- Grouped template: selecting the group still lets you click a cell. Hover a slot on the canvas shows a small “Replace” chip.
- `le-project` sanitizes `slot` (id, label, photo strings only).

## Engine (le-objects.js)
- `_paintImage`: if no bitmap/`src`, draw placeholder (surface-2 fill, 1.5px dashed line, plus mark).
- `mask` already uses shape ids (heart exists in `LE.assets.shapes`). Add aliases if needed: `circle`→ellipse, `round`→rounded-rect.
- Optional `maskPath` (SVG path in layer local 0..w,0..h) for silhouette heads. Sanitize: path commands only, cap length 20k.
- Phone handle size still a known gap; do not regress.

## Collage catalog
`assets/data/collages/index.json` (slim: styles + template ids, names, groups, slotCount, size, featured) + one pack per style `assets/data/collages/<styleId>.json`.

Each template:
```
{ id, style, name, w, h, bg, slots:[{id,x,y,w,h,rot,radius,mask,maskPath,border,shadow,caption,photo,z}], decor:[layer specs] }
```
`decor` is existing Scene layers (shape/text/svg) already used by templates: tape strips (rotated rounded-rects), tickets, captions, bursts, gradients. No JS in recipes.

### 40 classic / famous styles (at least 1 featured template each)
grid-2, grid-3, grid-4, masonry, mosaic, polaroid-wall, polaroid-scatter, film-strip, lookbook, moodboard, yearbook, family-cluster, honeycomb, diamond-grid, timeline, map-travel, postcard, instant-camera, torn-paper, comic-pop, heart-shape, circle-crop, star-mask, overlapping-cascade, bento-grid, magazine-cover, typography-poster, editorial-spread, newspaper, scrapbook, washi-tape, travel-journal, silhouette, panoramic, circular-mosaic, vaporwave, cottagecore, dark-academia, coquette, streetwear.

### Attached reference styles — 8–12 variations each (not 5 minimum, aim 8+)
silhouette, panoramic, shape-based (heart + star + circle clusters), circular, streetwear, coquette, dark-academia, cottagecore, pinterest-aesthetic, scrapbook, junk-journal, newspaper, magazine-cutout, washi-tape, ephemera, travel-journal, handwritten-journal, typography, editorial, vaporwave, digital-3d.

Variations change: page size (1080², 1080×1920 story, 1920×1080, 1600×900 panorama), slot count, rotation jitter, palette, caption copy, featured vs not. Featured ones also appear under Design → Templates.

**Do not ship hundreds of full-res photos.** Shared pool of ~48 compressed JPEGs (max edge 1200, q≈0.82, ~40–120 KB each) in `assets/photos/collage/` + `assets/data/collages/photos.json` `{id, file, w, h, source, photographer, url, license, query}`. Sources: Openverse (CC0/CC-BY) at build; if `PIXABAY_KEY` / `PEXELS_KEY` / `UNSPLASH_ACCESS_KEY` exist in env, mix those too. Attribution stored on the asset and shown in the stock/attribution row.

Apply flow:
1. If the user has ≥ slotCount uploads, fill slots from uploads (cycle).
2. Else fetch pool photos on demand (not precached) and ingest compressed.
3. Every cell is a slot.

## Stock library — `LE.stock` in `assets/js/le-stock.js`
Providers: **pixabay**, **pexels**, **openverse**. Unsplash is build-time only unless a user later pastes a key; do not add a Unsplash search tab unless trivial.

Keys: `localStorage` `le-stock-keys` `{ pixabay, pexels, openverse: { clientId, clientSecret, token, tokenExp, email } }`. Settings UI in Uploads → Stock → Keys, and a compact keys sheet.

### Pixabay — https://pixabay.com/api/docs/
`GET https://pixabay.com/api/?key=&q=&image_type=photo&safesearch=true&per_page=20&page=`
Use `webformatURL` for thumbs, `largeImageURL` (≤1280) to import. Never `imageURL` / original. Show Pixabay credit.

### Pexels — https://www.pexels.com/api/documentation/
`GET https://api.pexels.com/v1/search?query=&per_page=20&page=` header `Authorization: <raw key>` (not Bearer).
Thumbs: `src.medium`. Import: `src.large2x` (never `src.original`). Attribution: “Photo by X on Pexels” + link. Prominent “Photos provided by Pexels”.

### Openverse — https://api.openverse.org/v1/
Anonymous search works. Registered apps get the standard tier (historically 100/min).

Register flow (in-app, no backend):
1. Form: application name (default “LocalEditor on this device”), description, email.
2. `POST https://api.openverse.org/v1/auth_tokens/register/` JSON `{name, description, email}`.
3. Tell the user to verify the email Openverse sends. Until verified, stay on anonymous limits.
4. Response has `client_id`, `client_secret` — store locally, never log.
5. `POST https://api.openverse.org/v1/auth_tokens/token/` `application/x-www-form-urlencoded` `grant_type=client_credentials&client_id&client_secret`.
6. Use `Authorization: Bearer <access_token>`. Refresh when `tokenExp` is near (`expires_in` typically 36000s).
7. `GET /v1/rate_limit/` to show remaining quota.
8. Search: `GET https://api.openverse.org/v1/images/?q=&page=&page_size=20` (anon page_size max 20). Filter `mature=false`.
9. Results: `thumbnail` for grid, sized URL for import (see compression). Show `attribution` / license chip. CC licenses only.

If a provider 401s, prompt to re-enter the key. If 429, surface the retry and disable that provider briefly.

Normalized hit: `{ id, provider, thumb, importUrl, w, h, photographer, pageUrl, license, attribution, filesize }`.

## Auto-resize / compression — never pull 150 MB Wikimedia originals
`LE.stock.compress(blob, opts)` and `LE.stock.importHit(hit)`:
- Max edge = `LE.perf.level().previewMax` (2400/1600/1000) unless opts.maxEdge.
- JPEG quality 0.82 (PNG only if transparency needed).
- Skip re-encode if already JPEG, edge ≤ max, bytes ≤ 1.5 MB.
- **Wikimedia / Openverse:** if `filesize > 4e6` or URL is an original Commons file (`upload.wikimedia.org` without `/thumb/` / `px-`), rewrite to a thumb:
  - `https://commons.wikimedia.org/wiki/Special:FilePath/<file>?width=<maxEdge>`
  - or `/wikipedia/commons/thumb/<a>/<ab>/<file>/<maxEdge>px-<file>`
- Prefer Openverse `thumbnail` if filesize unknown and URL looks original.
- Abort fetch if `Content-Length > 12 MB`. Fallback to thumbnail.
- Decode via `createImageBitmap` / `LE.load`, draw to canvas, `toBlob('image/jpeg', q)`.
- Then existing `ingest` (assetBytes cap 80 MB — compressed result will be far under).
- Store attribution on `project.assets[id].source = { provider, photographer, pageUrl, license, attribution }`.

Also run compress on **local** files larger than 8 MB or longer edge > previewMax * 1.4 before ingest (keeps mid-range devices alive). Show a quiet toast “Photo resized for editing”.

## Studio UI (Claude)
- Design → Templates: groups Classic | Collage styles | Yours. Cards with CSS slot-art preview (not a 2 MB screenshot). Search. Apply creates slots + decor.
- Apps → Collage: keep simple grids, add “Style collages” linking to the catalog (same renderer).
- Uploads: tabs This device | Stock photos. Stock: provider chips, search, infinite scroll, click to add or replace. Keys button.
- Replace picker modal/sheet, phone-friendly.
- Gold buttons: ink `#2A1F0A`.
- Attribution strip when a stock/pool photo is selected.

## Service worker
`scripts/build.js` `ON_DEMAND` already excludes some data. Add:
`^assets\/photos\/collage\/|^assets\/data\/collages\/`
Runtime: cache-first for those into `le-assets-v1` after first use. Precache `le-stock.js` and `le-studio-collage.js`.

## Scripts
- `scripts/fetch-collage-photos.js` — download ~48 images, compress with `sharp` if present else canvas-less jpeg via `jimp` or raw ffmpeg; prefer Node `sharp`. Write photos.json. Rate-limit Openverse 1 req / 4s if anonymous.
- `scripts/build-collages.js` — emit index + style packs from a generator module so 200 templates stay compact.

## Tests
- `scripts/test-stock.html` — compress a fake large canvas; URL rewrite for a Commons original path; Openverse search (anonymous); slot placeholder paint.
- Browser: apply a collage, replace one cell from file, replace one from stock (Openverse anonymous), confirm file size of an imported hit is well under 2 MB.

## Files
New: `assets/js/le-stock.js`, `assets/js/le-studio-collage.js`, `assets/data/collages/**`, `assets/photos/collage/**`, scripts above, `scripts/test-stock.html`.
Edit: `le-objects.js`, `le-project.js`, `le-studio.js`, `le-studio-panels.js`, `studio/index.html`, `studio.css`, `scripts/build.js`.
Do not fight the PDF studio agent (`le-pdf*`, `pdf-studio*`).
