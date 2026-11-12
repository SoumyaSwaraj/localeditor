# Deploying LocalEditor (S3 + CloudFront)

LocalEditor is a folder of static files. "Deploying" means copying that folder to an Amazon S3 bucket and letting Amazon CloudFront serve it over HTTPS at your domain. Nothing runs on a server.

This guide assumes the bucket and the CloudFront distribution already exist (they did when this was written). If you are starting from nothing, do the one-time setup in section 4 first.

> **Status (12 Nov 2026):** `scripts/deploy.sh --dry-run` was run and prints the right commands. The real upload, the invalidation, the CloudFront Function and the headers policy have **not** been run against AWS from the build machine (it cannot reach AWS). The CSP and the function's logic were tested locally (see section 6). Do the first real deploy to a staging distribution if you have one.

## 1. What you need

- The repository on your computer, and Node.js 18 or newer (`node --version`).
- The AWS CLI version 2 (`aws --version`). Install: <https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html>.
- AWS credentials that may write to the bucket and create invalidations. Ask whoever owns the AWS account for an access key, then run `aws configure --profile localeditor` and paste it in. The policy those credentials need is at the end of this file.
- Two names: the **bucket** (for example `localeditor-site`) and the **distribution ID** (looks like `E2ABCDEF123456`; CloudFront console → Distributions).

## 2. Every deploy

From the repository root:

```bash
# 1. See what would happen. Changes nothing.
scripts/deploy.sh --bucket localeditor-site --distribution E2ABCDEF123456 --profile localeditor --dry-run

# 2. Do it.
scripts/deploy.sh --bucket localeditor-site --distribution E2ABCDEF123456 --profile localeditor
```

You can put the names in your shell instead: `export LE_BUCKET=localeditor-site LE_DISTRIBUTION=E2ABCDEF123456 AWS_PROFILE=localeditor`, then just run `scripts/deploy.sh`.

What the script does, in order:

1. Runs `node scripts/build.js`. This writes a fresh `sw.js` with a new version name. **This is what makes installed copies of the app notice the update**, so never skip it on a real deploy.
2. Checks that `sw.js`, `manifest.webmanifest`, `index.html` and `offline.html` exist and look right.
3. Uploads in passes, each with its own cache lifetime (table below). Long-lived files go first and pages and `sw.js` go last, so a visitor never gets a new page that points at a file that is not uploaded yet.
4. Asks CloudFront to forget its copies (`/*`, which counts as one invalidation path).

Options:

| Option | Use it when |
|---|---|
| `--dry-run` | Always first. Works even without the AWS CLI installed. |
| `--delete` | Files were removed or renamed in the repository and should disappear from the site too. |
| `--full` | You changed cache lifetimes or content types in the script. A normal deploy skips files whose size and date did not change, so their headers would not update. |
| `--skip-build` | You already ran `node scripts/build.js` and want exactly that `sw.js`. |

After a deploy, open the site, then open it again: installed copies show **"A new version of LocalEditor is ready"** and update when the person taps **Update now** (or by themselves the next time no tab has work open).

## 3. Cache lifetimes and why

| Files | `Cache-Control` | Why |
|---|---|---|
| Pages (`*.html`), `sw.js`, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, `llms.txt` | `no-cache` (always check) | Small, and they decide which version people get. |
| `assets/js/*`, `assets/css/*` | `max-age=600, must-revalidate` | Names do not change between versions. The app's offline copy (the service worker) keeps installed users consistent; this only covers first visits. |
| `assets/data/**/*.json` (icon packs, collage layouts) | `max-age=86400, stale-while-revalidate=604800` | Large, change rarely; the app also refreshes them in the background. |
| `assets/vendor/*`, `assets/icons/*`, `assets/screenshots/*` | `max-age=2592000` (30 days) | Stable, but names are not versioned, so not "immutable". |
| `assets/fonts/*`, `assets/photos/*`, `assets/img/*`, `assets/models/*`, `*.wasm` (the AI engine in `assets/vendor/ort/`), `*.onnx` | `max-age=31536000, immutable` | Content never changes under the same name. **If you ever replace one of these, give it a new file name.** |

Content types the CLI would get wrong are set explicitly: `manifest.webmanifest` → `application/manifest+json`, `*.wasm` → `application/wasm`, `*.onnx` → `application/octet-stream`, `*.mjs` → `text/javascript`, `*.leworkflow` → `application/vnd.localeditor.workflow+json`, `*.leproject` → `application/vnd.localeditor.project+zip`, graphics data → `application/json`.

Never uploaded: `scripts/`, `tests/`, `docs/`, `infra/`, Markdown files, `.git`, `.claude`, `node_modules`. Exceptions, published as `text/markdown` at their repository paths because `llms.txt` links them for agents: `docs/AGENT-GUIDE.md`, `docs/FORMAT-DESIGN.md`, `docs/FORMAT-WORKFLOW.md`, `docs/FORMAT-PDF-WORKFLOW.md` and `agent-kit/*`; plus `schema/*.json` (the design schema's `$id` URL).

## 4. One-time CloudFront setup

Do these once in the CloudFront console (or ask the AWS owner). Each step says what to click.

### 4a. Origin

Use the bucket's **REST endpoint** with Origin Access Control (OAC), not the "static website hosting" endpoint, so the bucket stays private. Distribution → Origins → Edit → Origin access → *Origin access control settings*, then copy the bucket policy CloudFront offers into the bucket.

### 4b. Folder pages: the CloudFront Function

The REST endpoint does not turn `/studio/` into `/studio/index.html`. `infra/cloudfront/viewer-request.js` does that, sends `/studio` to `/studio/`, and handles the share-sheet case below.

1. CloudFront → Functions → **Create function**, name `localeditor-viewer-request`, runtime **cloudfront-js-2.0**.
2. Paste the contents of `infra/cloudfront/viewer-request.js`, **Save**, then the **Test** tab: try `GET /studio/` (should become `/studio/index.html`) and `GET /studio` (should return 301).
3. **Publish**, then Distribution → Behaviors → default behavior → Edit → Function associations → *Viewer request* → CloudFront Functions → `localeditor-viewer-request`.

CLI equivalent:

```bash
aws cloudfront create-function --name localeditor-viewer-request \
  --function-config Comment="Directory index and redirects",Runtime=cloudfront-js-2.0 \
  --function-code fileb://infra/cloudfront/viewer-request.js
# then publish with the ETag it prints:
aws cloudfront publish-function --name localeditor-viewer-request --if-match ETAG
```

### 4c. Error pages

Distribution → Error pages: for **403** and **404**, response page `/404.html`, HTTP code **404**, error caching TTL **60** seconds. (A private bucket answers 403 for missing files.)

### 4d. Security headers: the response headers policy

`infra/cloudfront/response-headers-policy.json` sets the Content Security Policy, HSTS, `nosniff`, `X-Frame-Options: DENY`, a strict referrer policy and `Permissions-Policy` (camera, microphone, location, payment and similar all off). It deliberately sets no `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` (see 4e).

```bash
aws cloudfront create-response-headers-policy --response-headers-policy-config file://infra/cloudfront/response-headers-policy.json
```

Then Distribution → Behaviors → default → Edit → Response headers policy → `localeditor-security-headers`.

**Try it safely first:** in the console, edit the policy, remove the CSP from *Security headers* and add it as a *Custom header* named `Content-Security-Policy-Report-Only` with the same value. Use the site for a day with the browser console open (any blocked thing shows as a "[Report Only]" message), then switch it back to enforced.

What the CSP allows, and why:

- Scripts only from this site. `'unsafe-inline'` is needed because pages set the theme with a tiny inline script before CSS loads and older tool pages have inline scripts; hashing all of them does not fit CloudFront's header size limit. `'wasm-unsafe-eval'` lets on-device AI (WebAssembly) run; no JavaScript `eval` is allowed.
- `connect-src`: this site plus the stock photo services the person turns on: Pixabay (`pixabay.com`), Pexels (`api.pexels.com`), Openverse (`api.openverse.org`) and Unsplash (`api.unsplash.com`, `images.unsplash.com`). It also allows `https:` in general, because an Openverse photo is imported from wherever it is hosted (Flickr, Wikimedia and many others). If you prefer a strict list, drop `https:` from `connect-src`; Openverse imports from unlisted hosts will then fall back to the thumbnail or fail.
- `img-src 'self' data: blob: https:` because stock thumbnails are shown straight from the providers.
- `frame-ancestors 'none'`: nobody can embed the site in a frame.

### 4e. COOP / COEP and multi-threaded AI

Some on-device AI libraries run faster with several threads, which needs `SharedArrayBuffer`, which needs the page to be "cross-origin isolated": `Cross-Origin-Opener-Policy: same-origin` **and** `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`).

The catch: with `require-corp`, every image from another site must send a `Cross-Origin-Resource-Policy` header. Stock thumbnails (Pixabay, Pexels, Openverse sources) do not, so they would stop showing. `credentialless` keeps them working in Chrome, Edge and Firefox, but Safari does not support it.

**Recommendation: set neither COOP nor COEP for now.** The background-remover prototype measured that threads would gain at most 1.5 to 2 times, while `require-corp` would break the hot-linked stock thumbnails. The AI engine runs single-threaded and works everywhere. If that changes, add a second response headers policy with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` attached only to a `/studio/*` behavior, and test stock search there in Safari (which does not support `credentialless` and will simply stay single-threaded).

### 4f. Share target (Android "Share to LocalEditor")

When the app is installed on Android, photos shared to it are received by the app's offline worker on the phone; nothing is sent to CloudFront. If the worker is not running yet, the phone may send the photos to `/studio/` as a POST. To answer that gracefully instead of with an S3 error, set the default behavior's **Allowed HTTP methods** to *GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE*; the function above then replies with a redirect to the studio (nothing is stored or forwarded; S3 never sees the POST). If you leave methods at GET/HEAD, CloudFront answers that rare case with a 403, which is acceptable.

### 4g. Compression and HTTP/3

Behavior → *Compress objects automatically*: **Yes**. Distribution settings → HTTP versions: HTTP/2 and HTTP/3. Use the managed cache policy **CachingOptimized** (it respects the `Cache-Control` headers above).

## 5. Rolling back

Check out the previous commit and deploy it (`--full` is not needed). Because `scripts/build.js` gives `sw.js` a new version name every time, installed apps treat the rollback as an update and offer it like any other.

## 6. What was tested, and what was not

| Piece | Tested? |
|---|---|
| `deploy.sh --dry-run` (no AWS CLI present) prints every pass, the delete pass and the invalidation | Yes |
| Real upload, `--delete`, `--full`, invalidation | **No** (no AWS access from the build machine) |
| CloudFront Function logic (`/x/` → index, `/x` → 301 with query, POST → 303) | Yes, run in Node with sample events. Not yet run in CloudFront's own test tab |
| CSP: home, studio (with a design), PDF studio, Convert, Recipes and five tool pages served with the policy, zero violations | Yes, in Chromium |
| CSP in Safari and Firefox | **No** |
| Headers policy accepted by the AWS API | **No** |

## 7. IAM policy for the deploy credentials

Replace the bucket name, account ID and distribution ID.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::localeditor-site" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::localeditor-site/*" },
    { "Effect": "Allow", "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"], "Resource": "arn:aws:cloudfront::123456789012:distribution/E2ABCDEF123456" }
  ]
}
```
