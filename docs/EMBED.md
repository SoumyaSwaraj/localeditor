# The embed viewer (`/embed/`)

A small read-only view of one design for a blog post, a docs page or a README preview: the pages, drawn by the studio's own renderer, with page buttons and **Open in the studio to edit**. It never edits, saves or uploads anything.

Files: `embed/index.html`, `assets/css/embed.css`, `assets/js/le-embed.js`. Tests: `tests/embed.test.js`.

## Addresses

| Address | Shows |
|---|---|
| `/embed/#d=<payload>` | A template link (`docs/FORMAT-DESIGN.md`, "Template links"): the same payload as `/studio/#d=…`. Photos are not in a link, so they show as empty slots. The part after `#` never reaches a server. |
| `/embed/?src=<path>.json` | A design file **on this site** (same origin, a path that ends in `.json`), with its pictures when they are relative paths next to it. |
| `…&theme=light` or `…&theme=dark` | Forces a theme. Without it: the visitor's own choice on this site, else the system's. |

Anything else is a plain message in the viewer: no design, a file from another site, a missing file, a damaged or oversized link, a design the reader refuses.

## The snippet

The studio's Share sheet has **Copy embed code** (next to Copy link). It copies:

```html
<iframe src="https://localeditor.net/embed/#d=PAYLOAD" title="Design name" width="480" height="656"
  style="border:0;max-width:100%" loading="lazy"
  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
```

- The viewer fits whatever box the frame has; the height in the copied code suits the first page at 480 px wide.
- `allow-scripts allow-same-origin` is all the viewer needs to draw and page. With only those two, a frame cannot open a new tab, so **Open in the studio to edit** shows the address to copy instead. The two `allow-popups…` words let the button open the studio in a full tab.
- Give the frame a `title`; it is what a screen reader announces.

## What it loads, and from where

Blocking the first paint: the page (0.9 KB), `embed.css` (1.2 KB) and `le-embed.js` (4.4 KB) — **6.5 KB gzip**, checked by a test (under 8 KB). After the first paint it loads the site's tokens (`app.css`) and then the renderer on demand (`le-engine`, `le-objects`, `le-project`, `le-fx-boot`, `le-fonts`, `le-assets`, `le-collage`, `le-design`; about 180 KB gzip, shared with the studio's cache), plus the fonts, icons and effects the design uses.

Every request goes to the viewer's own origin. `?src=` is resolved against the page and refused unless it is same-origin; redirects are refused; `https://` pictures named in a design are never fetched (they stay empty slots).

## Safety

- The design is **data**. It goes through `LE.design.fromLink` / `LE.design.parse`, the same reader and safety gate as the studio (markup in text, `javascript:`, forbidden keys and oversized input are refused), and is drawn on a canvas. No text from it is ever set as HTML.
- The viewer writes nothing: no project is saved, nothing is added to Your designs, and it stores nothing.
- It has no inline script and no inline handler, so it runs under the site's content security policy unchanged.

## Deployment note (needed before anyone can embed it)

`infra/cloudfront/response-headers-policy.json` sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` for the whole site (`docs/DEPLOY.md`). That is right for the studio, and it also stops every other site from framing `/embed/`. To allow embedding, `/embed/*` needs its own cache behaviour with a response headers policy that is the same except: no `X-Frame-Options`, and `frame-ancestors *` (or a list of sites). Only the page itself needs it; the scripts and styles it loads are not framed. Until then the viewer works as a page of its own and in frames on this site's own origin in local testing.

## Keyboard and screen readers

- Tab order: the viewer, previous, next, Open in the studio to edit. Focus is always visible.
- With focus anywhere in the viewer: Right / Page Down next page, Left / Page Up previous, Home first, End last.
- The page position ("Page 2 of 4") is announced when it changes. Each picture has a text alternative: the design's name, the page position and the text on that page.
- Buttons are 44 px targets. Nothing scrolls sideways down to 320 px wide.
- Light and dark follow the site's theme tokens; the style sheet holds no colour of its own.

## Limits

- Pattern and texture page backgrounds that the studio redraws when a design is opened show as their base colour here.
- A design by `?src=` gets its studio button from a template link made on the spot; if the design is too large for a link the button is not shown.
- A page is drawn at up to 2048 px on its longer side.
