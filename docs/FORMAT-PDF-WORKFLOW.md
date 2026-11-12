# The `.lepdfworkflow` PDF workflow format

Status: **version 1.0**, 12 November 2026. Implemented in `assets/js/le-pdf-office.js` (`LE.pdfOffice.validateWorkflow`, `LE.pdfOffice.runWorkflow`). Tested in `tests/pdf-office.test.js`. It is the PDF sibling of the photo recipe format in `docs/FORMAT-WORKFLOW.md` and follows the same rules: data only, a fixed list of operations, strict validation.

A PDF workflow is a named, ordered list of steps that run on one or more PDFs, for example *combine → number the pages → watermark → make smaller → password-protect*. It is **data only**: no script, no HTML, no URLs that are fetched, no expressions, and **never a password**. An importer checks every field against the fixed lists below and either accepts the file (dropping harmless unknown fields with a warning) or rejects the whole file with a plain-language error. Nothing in a workflow is ever evaluated.

This document is exact. If you are an AI agent writing workflows, follow it literally: use only the operations and parameter names listed here, keep every number inside its range, and write numbers and booleans as JSON numbers and booleans (not strings).

## A complete example

```json
{
  "format": "localeditor-pdf-workflow",
  "version": "1.0",
  "metadata": {
    "id": "client-pack",
    "name": "Client pack",
    "description": "One pack with a cover and contents, numbered, cleaned and locked.",
    "author": "Northwind Legal",
    "tags": ["pack", "client"],
    "created": "2026-11-12"
  },
  "steps": [
    { "id": "pack", "operation": "bundle", "label": "Make a pack", "enabled": true,
      "parameters": { "title": "Client pack", "subtitle": "", "preparedBy": "", "preparedFor": "", "date": "today", "cover": true, "contents": true, "bookmarks": true, "paper": "a4" } },
    { "id": "numbers", "operation": "page-numbers", "label": "Number the pages", "enabled": true,
      "parameters": { "position": "bc", "format": "page-n-of-N", "start": 1, "skipFirst": true, "size": 9.5 } },
    { "id": "clean", "operation": "scrub", "label": "Remove hidden details", "enabled": true,
      "parameters": { "metadata": true, "attachments": true, "comments": "flatten", "forms": "flatten", "links": false, "hiddenText": true } },
    { "id": "lock", "operation": "protect", "label": "Password-protect", "enabled": true,
      "parameters": { "ask": true, "printing": "high", "copying": true, "modifying": false } }
  ]
}
```

The smallest valid file:

```json
{ "format": "localeditor-pdf-workflow", "version": "1.0", "steps": [{ "operation": "page-numbers" }] }
```

## File

- Extension `.lepdfworkflow`; content is UTF-8 JSON. Suggested media type `application/vnd.localeditor.pdf-workflow+json` (`application/json` is fine).
- The studio's Office kit → **Saved workflows** imports, edits, saves (in this browser, `localStorage` key `le-pdf-workflows`, at most 40), exports and shares these files.

## Top-level fields

| Field | Required | Type | Rules |
|---|---|---|---|
| `format` | yes | string | Exactly `"localeditor-pdf-workflow"`. |
| `version` | yes | string (or number) | `"1.0"`; any `"1.x"` is read. A major version above 1 is refused ("needs a newer LocalEditor"). The number `1` is read as `"1"`. Files are always written as `"1.0"`. |
| `metadata` | no | object | See below. |
| `steps` | yes | array | **1 to 30** steps, run top to bottom. |

Any other top-level field is dropped with a warning.

### `metadata`

| Field | Type | Rules |
|---|---|---|
| `id` | string | Lower-cased and slugged to `[a-z0-9-]`, max 60. Missing → slug of the name. Saving a workflow with the same id replaces the saved one. |
| `name` | string | Max 80 characters, control characters and `<` `>` removed. Default `"Untitled workflow"`. |
| `description` | string | Max 400. |
| `author` | string | Max 80. |
| `tags` | array of strings | First 8 kept, each slugged, max 24. |
| `created` | string | `YYYY-MM-DD`. Missing or malformed → today. |

Other metadata fields are dropped with a warning.

### A step

| Field | Type | Rules |
|---|---|---|
| `operation` | string | **Required.** One of the operations below. Anything else rejects the file. |
| `parameters` | object | Parameters for that operation. Omitted parameters take the default shown. May be omitted entirely. |
| `id` | string | `[A-Za-z0-9_-]{1,40}`, unique. Missing or duplicate → `<operation>-<n>`. |
| `label` | string | Shown to people. Max 60. Default: the operation's label. |
| `enabled` | boolean | Default `true`. `false` keeps the step but skips it. A non-boolean rejects the file. |

## How a workflow runs

- Input: one or more PDFs. Each step runs on every file in turn; the output of a step is the input of the next.
- **`merge` and `bundle` combine** every file into one; steps after them run on that one file. A workflow may contain at most one combining step.
- Without a combining step, each file is processed on its own; several results download as one zip.
- If any step fails, the run stops and nothing is downloaded; the run log names the step and the reason.
- Locked (password-protected) inputs are refused; unlock them first (Bulk → Password-protect or unlock).

## Parameter rules

- **Numbers** must be JSON numbers inside the range given; `int` means a whole number. `"12"` (a string) and out-of-range values **reject the file**; they are not clamped.
- **Enums** must be one of the listed values exactly (numbers stay numbers, e.g. `90`).
- **Booleans** are `true` or `false`.
- **Text** is a JSON string within the length given; control characters and `<` `>` are removed.
- **Colours** are `#rrggbb`.
- **Pages** (type `pages`) are `"all"`, `"odd"`, `"even"`, `"first"`, `"last"`, or a list of numbers and ranges such as `"1-3, 7, 10-"` (1-based, spaces allowed, `10-` means "10 to the end").
- An **unknown parameter** is dropped with a warning; the file is still accepted.

Positions: `tl` `tc` `tr` (top left/centre/right), `bl` `bc` `br` (bottom). The stamp also accepts `cc` (centre of the page).

Text tokens in `header-footer`: `{page}`, `{pages}`, `{title}` (the PDF's title, else the file name), `{date}` (today), `{file}` (the file name).

## Operations (the complete allow-list)

| Operation | What it does | Parameters (type, range, default) | Runs |
|---|---|---|---|
| `merge` | Combines all files into one, in order. | `order` enum `as-given` \| `name` (`as-given`) | `pdf-lib` copy pages |
| `bundle` | Combines all files into a pack with a cover, a clickable contents page and bookmarks (one per file, keeping each file's own bookmarks). | `title` text 120 (`""` → "Document pack"), `subtitle` text 160, `preparedBy` text 80, `preparedFor` text 80, `date` text 40 (`"today"`), `cover` bool (`true`), `contents` bool (`true`), `bookmarks` bool (`true`), `paper` enum `a4` \| `letter` \| `legal` (`a4`) | `LE.pdfOffice.bundle` |
| `rotate` | Turns pages clockwise. | `degrees` enum `90` \| `180` \| `270` (`90`), `pages` pages (`"all"`) | `pdf-lib` |
| `delete-pages` | Removes pages. A step that would remove every page fails. | `pages` pages, **required** | `pdf-lib` |
| `keep-pages` | Keeps only these pages. | `pages` pages, **required** | `pdf-lib` |
| `reverse` | Reverses page order. | none | `pdf-lib` |
| `page-numbers` | Prints page numbers. | `position` (`bc`), `format` enum `n` ("3") \| `page-n` ("Page 3") \| `n-of-N` ("3 of 12") \| `page-n-of-N` ("Page 3 of 12") \| `n/N` ("3 / 12") \| `-n-` ("– 3 –") (`page-n-of-N`), `start` int 0–100000 (`1`), `skipFirst` bool (`false`; the first page gets no number and numbering starts on page 2), `size` num 6–24 (`9.5`) | `LE.pdfOffice.stampChrome` |
| `header-footer` | Prints a header and/or footer. | `headerLeft`, `headerCenter`, `headerRight`, `footerLeft`, `footerCenter`, `footerRight` text 120 (`""`), `skipFirst` bool (`false`) | `LE.pdfOffice.stampChrome` |
| `bates` | Prints Bates numbers, continuing across files in the same run. | `prefix` text 24 (`"DOC-"`), `start` int 0–99999999 (`1`), `digits` int 1–12 (`6`), `position` (`br`) | `LE.pdfOffice.stampChrome` |
| `watermark` | A text watermark on every page. | `text` text 80, **required** (`"CONFIDENTIAL"`), `style` enum `diagonal` \| `tiled` \| `footer` (`diagonal`), `opacity` num 0.03–1 (`0.15`), `color` colour (`#C62828`), `size` num 0–200 (`0` = automatic) | `LE.pdfBulk.watermark` |
| `stamp` | An office stamp drawn into the page. | `preset` enum `approved` \| `paid` \| `received` \| `reviewed` \| `draft` \| `copy` \| `confidential` \| `void` \| `custom` (`approved`), `text` text 40 (required when `custom`), `color` colour or `""` (preset colour), `shape` enum `rounded` \| `box` \| `oval` \| `plain` (`rounded`), `name` text 60 (`""`), `date` bool (`true`, the run date), `time` bool (`false`), `pages` enum `all` \| `first` \| `last` (`first`), `position` enum `tl` `tc` `tr` `cc` `bl` `bc` `br` (`tr`), `size` num 8–72 (`20`) | `LE.pdfOffice.stampPages` |
| `metadata` | Sets title, author and subject (empty text leaves the field as it is). | `title` text 200, `author` text 120, `subject` text 200 | `pdf-lib` |
| `comment-summary` | Appends a summary of every comment, note and highlight, each linking back to its page. | none | `LE.pdfOffice.commentSummary` |
| `compress` | Makes the file smaller. Text and drawings stay sharp unless `allowPictures` is `true`. | `preset` enum `email` (under 10 MB) \| `2mb` \| `500kb` \| `lossless` (`email`), `allowPictures` bool (`false`) | `LE.pdfBulk.compress` |
| `scrub` | Removes hidden details. | `metadata` bool (`true`; also removes the document ID), `attachments` bool (`true`), `comments` enum `keep` \| `flatten` \| `remove` (`keep`), `forms` enum `keep` \| `flatten` \| `remove` (`keep`), `links` bool (`false`; `true` removes links), `hiddenText` bool (`true`) | `LE.pdfSecurity.scrub` |
| `make-safe` | Removes scripts, automatic actions, launch/submit actions, media and (unless kept) attachments. | `keepAttachments` bool (`false`) | `LE.pdfSecurity.makeSafe` |
| `safe-to-send` | Flattens, scrubs, removes active content and compresses, then re-checks the result. | `flatten` bool (`true`), `removeLinks` bool (`false`), `compress` bool (`true`) | `LE.pdfSecurity.safeToSend` |
| `protect` | Locks the file with a password (AES-256). **The password is asked for each time the workflow runs and is never stored.** | `ask` enum `true` only (`true`), `printing` enum `high` \| `low` \| `none` (`high`), `copying` bool (`true`), `modifying` bool (`false`; also controls annotating and page assembly) | `LE.pdfBulk.protect` |

## Passwords and secrets

A workflow file never holds a password. The validator rejects the whole file if **any key anywhere** (at any depth, in metadata, steps or parameters) is named `password`, `passwords`, `userPassword`, `ownerPassword`, `currentPassword`, `pass`, `pwd`, `passcode`, `secret`, `key`, `token` or `pin` (any letter case), with the message "Workflows never store passwords or keys…". A `protect` step stores only `"ask": true`; the runner asks the person (the studio shows a password dialog, typed twice) and keeps the password in memory for that run only.

## What importers reject

The whole file is refused, and nothing runs, when:

- it is larger than **200,000 characters**, not JSON, or nested deeper than **8** levels;
- any key anywhere is `__proto__`, `constructor` or `prototype`;
- any key anywhere is a password or secret name (above);
- any string anywhere (keys included) contains markup or script: `<script`, `<iframe`, `<svg`, `<img`, `<a `, `<style`, `<object`, `<embed`, `<link`, `<meta`, `javascript:`, `vbscript:`, `data:text/html`, or an `on…=` handler;
- `format` is not `localeditor-pdf-workflow`, or `version` is missing or above 1.x;
- `steps` is missing, empty, or longer than 30;
- a step is not an object, its `operation` is not in the list, its `parameters` is not an object, or `enabled` is not a boolean;
- a parameter has the wrong type, is outside its range, or is not one of its listed values; a required parameter is empty;
- a custom stamp has no text;
- more than one step combines files (`merge`, `bundle`).

## Built-in workflows

| Id | Name | Steps |
|---|---|---|
| `safe-to-send` | Safe to send | `safe-to-send` |
| `email-friendly` | Email-friendly | `scrub` (details only) → `compress` (`email`) |
| `numbered-draft` | Numbered and watermarked draft | `page-numbers` (Page X of Y) → `stamp` (Draft, dated, first page) → `watermark` ("DRAFT", 8 %) |
| `client-pack` | Client pack | `bundle` → `page-numbers` (skip cover) → `scrub` (flatten forms and comments) → `protect` (asks for a password) |

## Code

```js
LE.pdfOffice.validateWorkflow(textOrObject)   // → { ok, errors, warnings, workflow (normalised) }
LE.pdfOffice.workflows.serialize(workflow)    // → pretty JSON text (validated)
LE.pdfOffice.runWorkflow(files, workflow, { password?, askPassword?: async () => string, onProgress?, isCancelled? })
                                             // files: [{ name, bytes }] → { files: [{ name, bytes }], log: [{ step, operation, label, ok, detail }] }
LE.pdfOffice.workflows.builtins() / saved() / save(w) / remove(id) / operations()
```

`runWorkflow` needs the PDF studio page (it calls `LE.pdfBulk` for watermark, compress and protect, and `LE.pdfSecurity` for scrub, make-safe and safe-to-send); a step whose engine is not loaded fails with a clear message.

## Writing workflows as an agent: checklist

1. Start from the smallest valid file and add steps.
2. One operation per step; give each a short `label` people understand ("Number the pages", not "page-numbers").
3. Put a combining step (`merge` or `bundle`) first when the workflow should produce one file.
4. Put `compress` after steps that draw on the page and `protect` last; nothing can change a file after it is locked.
5. Never include a password. Use `{ "operation": "protect" }`; the person types the password when they run it.
6. Validate: open the PDF studio → Office kit → Saved workflows → Import. Errors name the step and the field.
