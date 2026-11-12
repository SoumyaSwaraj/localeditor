# QA report — baseline (roadmap item 1.8)

Written 12 November 2026 by QA, against `main` at `d376d0e` (roadmap commit) before any of the Phase 1 feature branches. Chromium only (Playwright), localhost, service workers blocked, no network latency.
For the architect (what to fix first) and the designer (what the phone and desktop studio feel like today).

Screenshots are not committed. They live in `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/qa/` (called `$QA` below). The scripts that made them are in `tests/qa/` and can be re-run (`node tests/qa/phone-walk.js phone`, `desktop-walk.js`, `a11y.js`, `perf.js`).

**Regression suite:** `node tests/run.js` — 11 files, 207 cases (187 pass, 20 `known`, 0 fail; 183 s with `TEST_JOBS=3`, about 7 min serial on a shared machine), each bug below that can be automated is a `KNOWN-BUG:` case that currently shows as `known` and flips to a plain pass when fixed (the runner prints "known bug now passes"). The case id in brackets (QA-0xx) is part of the case name, so `TEST_CASE=QA-007 node tests/run.js` runs it.

Everything that was checked and found fine is covered by passing cases; the headline is that the stable core works. Across 80 randomly ordered commands (3 seeds, desktop and phone) the studio threw no errors and wrote no `NaN` into the document. All 31 tool and info pages load with an empty console and no sideways scroll at 390 px. No blocker was found.

---

## 1. Bugs

Sorted by severity. "Twice" = reproduced in two independent runs (or two viewports). Where a test exists its name is given; `$QA` paths are screenshots.

| Id | Sev | Area | Viewport | Repro | Expected vs actual | Test | Screenshot |
|---|---|---|---|---|---|---|---|
| QA-001 | major | Studio › Adjust | all | Open a photo → Adjust → drag Brightness to 25 and Saturation to 40 → click **Reset adjustments**. | Expected: all sliders return to 0 (`layer.adjust` empty). Actual: nothing changes, document keeps `{"brightness":25,"saturation":40}`. The button calls `patch(id,{adjust:{}})` and the empty object is merged, not replaced. The per-slider double-click reset works. | `studio-edit › KNOWN-BUG: "Reset adjustments"…(QA-001)` | — |
| QA-004 | major | Studio › selection | phone 390 and 360 | Text → **Add a heading**, close the sheet, put a finger on the middle of the heading and drag. | Expected: heading moves. Actual: the finger lands on a resize handle (`data-h="s"`): at fit zoom a heading is 273×46 css px, the 22 px edge handles (n, s, e, w) overlap the text centre, so the first touch resizes or does nothing. Dragging works only if you touch about 25 % in from an end. Same on small shapes. | `studio-phone › KNOWN-BUG: …middle of a selected heading… (QA-004)` ×2 | `$QA/ph-text-0.png`, `$QA/phone-10-A9-caption-committed.png` |
| QA-007 | major | Keyboard / a11y | desktop | Select a text layer, Tab to **Italic**, press Enter (or just wait for autosave). | Expected: focus stays on the toolbar button. Actual: the toolbar is re-rendered, focus falls to `<body>`, and the next Tab starts again at **Font**. Every toolbar action and every autosave (≈ 0.7 s after an edit) resets keyboard position. Seen twice in a 70-Tab walk (the toolbar shows up twice in the focus order) and in a direct probe. | `studio-panels › KNOWN-BUG: toolbar buttons keep keyboard focus…(QA-007)` | — |
| QA-008 | major | Keyboard / a11y | desktop | Tab to **File**, press Enter, press ArrowDown / Tab. | Expected: focus moves into the menu, Arrow keys move between items. Actual: focus stays on File; Tab goes on to the header buttons. The File, Flip, Align, Order, Zoom and Pages menus (all in `#sx-pop`, at the end of the DOM) cannot be operated from the keyboard. New design, Export .leproject, Import are mouse/touch only. | `studio-panels › KNOWN-BUG: the File menu opened with the keyboard…(QA-008)` | — |
| QA-010 | major | Convert to PDF | all | `/convert-to-pdf/` → Choose files → `sample.docx`, `sample.md`, `sample.html` or `sample.pptx` → Download. | Expected: a PDF with selectable, searchable text (like `.txt`, `.csv`, `.xlsx`, which do keep text). Actual: DOCX, MD, HTML and PPTX come out as page pictures: no text layer (pdf.js finds 0 characters), the 3-page DOCX is 765 KB, the one-page Markdown 52 KB. Output files are valid and the right page count. | `tools › KNOWN-BUG: converted DOCX / Markdown PDFs keep selectable text (QA-010)` | — |
| QA-012 | major | Studio › toolbar | desktop 1440×900 and below | Add text, select it, open the Text panel (or any panel). | Expected: the selection toolbar fits or shows an overflow menu. Actual: at **1440×900** Lock, Duplicate and Delete are cut off; at 1366×768 also Copy style; at 1280×720 with a photo selected Duplicate, Delete and More are cut off; at 1280×560 Position onward. The strip scrolls (`overflow-x:auto`) but the scrollbar is hidden and a plain mouse wheel does **not** scroll it (only Shift+wheel / trackpad). A mouse user cannot see that Delete exists. | `studio-layout › KNOWN-BUG: 1440x900 with text selected…(QA-012)` | `$QA/desk-1280x560-4-text.png` |
| QA-015 | major | Studio › large photos | all | Open a 4000×3000 JPEG (a normal 12 MP phone photo) via **Open a photo**. | Expected: export at 1× matches the original, or the person is told. Actual: the file is cut to 2400×1800 on opening (toast "Photo resized for editing"), the page is 2400×1800 and the **1× export is 2400×1800** (36 % of the pixels). The 2×–4× chips then upscale the reduced copy to 4800–9600 px. No option exports the original size. | `studio-export › KNOWN-BUG: a 4000x3000 photo exported at 1x keeps its original pixel size (QA-015)` | — |
| QA-002 | minor | Dialogs / a11y | all | Start screen → **Custom size**. | Expected: dialog name "Custom size". Actual: `aria-label="Custom <em>size</em>"` — HTML source is read out. Same pattern in every dialog title built with `<em>`. | `studio-panels › KNOWN-BUG: dialog accessible names…(QA-002)` | — |
| QA-005 | minor | Studio › text toolbar | phone 390 and 360 | Select text; look at **−** / **+** next to the size field. | Tap target 32×38 px (roadmap A8 and the brief: ≥ 44, minimum 40). Every other toolbar and tab-bar button passes (tab bar 64×58). | `studio-phone › KNOWN-BUG: text size +/- buttons…(QA-005)` ×2 | `$QA/small-08-A7-heading-added-editing.png` |
| QA-006 | minor | Studio › header | phone 390 and 360 | Look at File and Download in the top bar. | File is 44×36, Download 43×36, rest of the header 40×40. Download is the main action and the smallest. | `studio-phone › KNOWN-BUG: header Download and File…(QA-006)` ×2 | `$QA/phone-01-A0-start.png` |
| QA-011 | minor | Dialogs / a11y | desktop | Press **?** on the canvas, then Tab ten times. | Focus enters the dialog (good) but Tab leaves it for the page behind; Esc closes it (good). | `studio-panels › KNOWN-BUG: the shortcuts dialog traps Tab focus…(QA-011)` | — |
| QA-013 | minor | Studio › rail | desktop 1366×768, 1280×720, 1280×560 | Open any design at those heights. | Rail has 12 tools at 61 px each. At 768 tall **Apps** (where Collage lives) is below the fold; at 720 Projects and Apps; at 560 Recipes, Projects and Apps. The rail scrolls but the scrollbar is hidden. | `studio-layout › KNOWN-BUG: 1366x768 and 1280x720 show every rail tool…(QA-013)` | `$QA/desk-1280x560-1-photo.png` |
| QA-014 | minor | Studio › Export | desktop ≤ 1280×720 | Open Download. | The gold **Download** button is below the fold of the panel at 1280×720 (bottom 743 of 720), 1280×560 and 1024×600; the person has to scroll the panel to find it. Fine at 1366×768. | `studio-layout › KNOWN-BUG: 1280x720 the Download button…(QA-014)` | `$QA/desk-1280x560-5-export.png` |
| QA-016 | minor | Tools › image converter | all | Add a JPG, click **PNG**, click **Download all** straight away. | Expected: a PNG. Actual: a JPEG named `.jpg` — the file is re-encoded in the background and the button is not disabled meanwhile. Deterministic when immediate (3/3); a person on a 12 MP photo would hit it. Not flaky, a race. | `tools › KNOWN-BUG: image converter: Download all right after switching…(QA-016)` | — |
| QA-009 | polish | Theme | all | Home page `/` → computed colour of **Open studio**. | Expected `#2A1F0A` (HANDOFF rule); actual `rgb(44,34,15)` = `#2C220F` (`--gold-ink` in `app.css`, light and dark). Studios, PDF studio and convert page are correct. | `themes › KNOWN-BUG: light/dark: home page gold buttons…(QA-009)` | — |
| QA-017 | polish | Elements panel | all | Elements → Shapes: compare **Rounded rectangle** with **Circle**. | The Rounded rectangle thumbnail is drawn with a 24-unit radius on a 48 box, so it is a circle. The layer it adds is correct (300×300, radius 24). | `studio-core › KNOWN-BUG: the Rounded rectangle thumbnail…(QA-017)` | `$QA/desk-shape-tiles.png` |
| QA-003 | polish | Studio › lock | desktop, phone | Lock a layer, click it on the canvas. | A locked layer cannot be selected on the canvas: the click deselects everything. The only way back is the Layers panel eye/lock row. Canva-style tools select it and offer an unlock chip. (May be intended; it is a dead end for a first-time user.) | covered by `studio-core › lock stops moving…` (selects programmatically) | — |
| QA-018 | polish | Layers panel / a11y | all | Inspect the eye and lock buttons. | `aria-label="Hide layer"` together with `aria-pressed="true"` (also Lock/Unlock): a screen reader says "Hide layer, pressed" — a double negative. Use one pattern (label fixed, state in `aria-pressed`). | — | — |
| QA-019 | polish | Panels / a11y | all | Inspect panel tab strips. | Two `role=tab` buttons (in the Layers panel) have no `aria-controls`. | — | — |

**Flaky, not broken (so nobody chases them):**
- *Click lost right after a synthetic touch fling.* Chrome drops the first tap after a fast scripted `touchMove` sequence (pointerdown and pointerup fire, no click). Reproduced in tests only; waiting 1.5 s makes the tap work. It is Chrome's fling-stop behaviour, not the studio. `h.touchDrag` callers should wait before tapping.
- *Delete a design* test once failed under CPU load because the confirm dialog had not yet appeared when the test looked; the test now waits for it.

**Product limits noted, not filed as bugs:** background-photo editing, the collage builder, recipes and stock UI are being rebuilt (shallow "panel opens" cases only). The page canvas shows a "Hold to compare" button that cannot be reached by keyboard (hold gesture; `\` works).

---

## 2. Phone usability review

Method: Playwright with touch emulation (`hasTouch`, `isMobile`), 390×844 and 360×740, real taps and CDP touch drags, screenshots at each step and every one looked at. Tasks: (A) Instagram post from a photo with a caption, (B) 4-photo collage, (C) remove/replace a background, (D) export and share. Screenshots: `$QA/phone-NN-*.png` (390) and `$QA/small-NN-*.png` (360); extra panels `$QA/phone-P-*.png`, collage `$QA/phone-B*-*.png`.

What works well: the sheets open and snap smoothly, the grip toggles height, the tab bar buttons are 64×58, no sideways scroll in any panel, tapping selects, a finger stroke in Draw produces a path, the "Replace" chip and Replace sheet (Uploads / This device / Stock photos) are clear, and the collage templates fill with four photos in one tap.

### Top 20 friction points, in priority order

| # | Person is trying to… | What gets in the way | Suggestion |
|---|---|---|---|
| 1 | **Find Collage, Projects, Recipes, Export** | The tab bar has 13 tabs but 390 px shows 6 (843 px of content, scrollbar hidden, no fade or arrow). Apps → Collage is the 12th tab. A first-time user cannot know there are more (`$QA/phone-01-A0-start.png`). | 5 primary tabs (Design, Elements, Text, Uploads, More) with the rest in a "More" sheet, or at minimum an edge fade plus a half-visible next tab. |
| 2 | **See what they are editing** | The sheet's short snap takes 336 px of 844 (290 of 740 at 360), the toolbar 60 px and the header 52 px: the canvas is about 330 px tall, the 1080 page shown at 28 %. Adjust, Filters and Text are all done on a thumbnail (`phone-P-adjust.png`). | Peek sheet (about 30 %) by default; while a slider is dragged shrink the sheet to just that slider ("peek while dragging"); let the sheet slide away when a text edit starts. |
| 3 | **Preview a size change** | The "Previewing Instagram post" bar (Cancel / Use this size / Fill-Fit-Stretch / Scale content) sits **on top of the canvas**, hiding the photo it is previewing (`phone-05-A4-size-preview.png`). | Dock the bar at the top under the header or inside the sheet; collapse the sheet to a mini bar while previewing. |
| 4 | **Add a caption** | Text → *Add a heading* leaves the 336 px Text sheet open over a 270 px canvas, with the heading partly hidden by handles; typing on a real keyboard will cover the rest (`phone-08-A7-heading-added-editing.png`). | Close or peek the sheet on *Add*, scroll the text above the keyboard, and show a "Done" button next to the text toolbar. |
| 5 | **Style the caption** | The contextual toolbar is one scrolling row of about 20 buttons; at 390 only font, size, colour, B (and half of I) are visible. Underline, case, align, spacing, Effects, Position, Delete are off-screen with no cue (`phone-08…`, `small-08…`). | Two tiers: primary (font, size, colour, B/I, align) + "More" sheet; or a Text sheet with tabs. Add the same edge fade as #1. |
| 6 | **Drag or resize a small object** | Eight 22 px square handles plus a rotate dot surround every selected object; on a heading or a 150 px collage cell they cover the content and the centre (QA-004). | Only 4 corner handles under about 120 px, edge handles hidden, invisible 44 px hit area around corners, drag from anywhere inside; handles drawn smaller than their hit area. |
| 7 | **Duplicate / delete / lock** | A floating "mini bar" (duplicate, delete, lock, ⋯) hovers over the photo, jumps above/below as the selection moves, covers the subject (`phone-02…`, `phone-10…`), and repeats Duplicate/Delete/Lock that the bottom toolbar already has. | Keep one: the bottom toolbar. If the floating bar stays, pin it to a fixed edge of the canvas. |
| 8 | **Download** | Header Download is an icon-only 43×36 gold button; it opens a sheet where the real **Download** button is below the fold (scroll inside the 336 px sheet: `phone-12…`, `phone-13…`). Steps: tap icon → scroll sheet → tap Download. | Make the sheet's CTA sticky at the bottom, and let the header button label itself ("Download") when there is room; one-tap "Save as PNG" default with "More options". |
| 9 | **Share** | There is no share anywhere: no Web Share, no "Open"/"Share" after the *Downloaded 1.5 MB* toast. On a phone the file lands in Downloads, not the gallery. | Add `navigator.share({files})` as the primary button where supported (and "Save to Photos" copy on iOS), keep Download second. |
| 10 | **Read feedback** | Toasts sit over the thing being used: "Resized to 1080 × 1080 from the original" covers the Text sheet and the text field for 5 s, "Downloaded 1.5 MB" covers the tab bar labels (`phone-14…`, `phone-16-B1-apps-sheet.png`). No dismiss, no undo link. | Put toasts above the toolbar, shorter, swipe to dismiss; add Undo to destructive ones. |
| 11 | **Start with an Instagram post from a photo** | Open a photo makes a 480×640 page. To get 1080×1080: Design tab → Resize tab (it is the default) → scroll → Instagram post → Fill/Fit/Stretch → Use this size = 6 taps and one preview bar (#3). | After the photo opens, offer "Fit to: Post · Portrait · Story · Wide" chips in the toolbar, or let the start screen's size cards ask for a photo ("Instagram post → choose photo"). |
| 12 | **Use "Design" to resize or find templates** | "Design" contains Templates, Resize and Size history; it opens on Resize if that was used last, with a card "Current page 480×640 / Reset to original" wrapping onto two lines. The **Resize** button in the toolbar and the sizes list repeat each other. The panel title on the Layers tab is "Position". | Name tabs by task ("Layouts", "Sizes"), always open on Templates for a blank page and Sizes for a photo; keep one entry point; title the panel after the rail label. |
| 13 | **Make a 4-photo collage from their photos** | Apps → Collage → "2 × 2" does **nothing** when there are no photos (zero layers, no message; the explanation "0 photos in this design. Cells cycle through your uploads" is below the fold). The other route, Design → Templates → Collage, silently fills the cells with **library photos the user did not choose** and a toast "Tap a photo to replace it" (`phone-B7-template-applied.png`). | Ask for the four photos first ("Choose 4 photos" multi-picker), show empty dashed cells otherwise, and never pre-fill with stock photos without a visible label. (1.3 is rebuilding this; the order of steps is the point.) |
| 14 | **Replace one photo in a slot** | Works (tap, "Replace" chip, sheet), but each 150 px cell now has 8 handles, the chip, the floating bar and a 7-button toolbar around it. The Replace sheet has an orphaned label "Other photos on this device" with nothing under it (`phone-B9-replace-sheet.png`). | Slots are not resized from handles: show only the chip and a small "crop" affordance; fix or hide the empty label. |
| 15 | **Remove a background** | There is no "Remove background" in the Background tab (it is the page background: solid / gradients / patterns / photos, opening on a large colour picker). The remover is *More ⋯ → "Remove flat background"* on the photo and only works on flat colours (`phone-20-C1-background-sheet.png`, `phone-23-C4-more-menu.png`). | Put "Remove background" on the photo toolbar and as the first item of the Background tab; say "works on plain backgrounds" in the label (1.7 spike decides the AI route). |
| 16 | **Switch Elements tab / template group** | Tab strips cut off at the edge: Elements shows "Frames" half visible, Templates shows "Classic · Collage · Text layouts · Ne…" (`phone-P-elements.png`, `phone-B7…`). No cue that they scroll. | Wrap to two rows or add fade; keep labels short. |
| 17 | **Move between pages and zoom** | On phone the footer (pages, size, zoom, fit, compare) is hidden. Pages are reachable only from an unlabeled 44 px icon in the no-selection toolbar; there is no visible Fit control after pinch-zooming. | A small "1/2" page pill and a floating "Fit" chip when zoomed. |
| 18 | **Draw** | Pen / Marker / Highlighter / Eraser appear twice (toolbar and sheet), eating height; the Size slider is cut off by the tab bar (`phone-P-draw-stroke.png`). Drawing itself works with a finger. | Keep the toolbar row only; sheet holds size, colour. |
| 19 | **Understand the instructions** | Copy is written for a mouse: "Double-click any text…", "Drag photos onto the canvas, or paste with Ctrl V", "Double-click a name to rename. Shift-click to select several", "or drop photos anywhere · paste with Ctrl V" on the start screen. Long-press multi-select exists but is not mentioned. | Detect `(pointer:coarse)` and use "Double-tap", "Tap and hold", "Choose photos". |
| 20 | **Start a design** | The start screen shows the full tool tab bar, a gold Download button and disabled Undo/Redo before any design exists, three equal-weight buttons stacked above the size cards, and the cards below the fold (`phone-01-A0-start.png`). | Hide tab bar and header actions until a design exists; "Open a photo" primary, the other two as links; size cards first. |

Other measurements from the walk: tap targets under 40 px per screen — start 2, photo selected 2, Design sheet 7, Export sheet 15–17 (size chips about 30 px high, option rows), Background 3–5, Replace sheet 6. No screen scrolled sideways at either size.

---

## 3. Desktop usability notes (top 10)

Measured by `tests/qa/desktop-walk.js` at 1440×900, 1366×768, 1280×720, 1280×560 (and 1024×600). Console clean at all sizes; no page-level scroll; stage never smaller than 860×420.

| # | Person is trying to… | What gets in the way | Suggestion |
|---|---|---|---|
| 1 | **Delete, duplicate or lock the selection with the panel open** | QA-012: those buttons are cut off by the toolbar at the default 1440×900 when a text layer is selected and a panel is open; the scrollbar is hidden and the plain wheel does not scroll it. | Overflow "⋯" menu for lower-priority buttons, or collapse labels (Effects, Position) to icons earlier. |
| 2 | **Reach Apps / Collage / Projects** | QA-013: the rail is 12 tools × 61 px; below 800 px tall the last ones disappear into a hidden-scrollbar scroll area (Apps at 768, Projects and Recipes at 560). | Smaller rail rhythm below 800 px (icon-only, 44 px), or group Recipes/Projects/Apps under one "Library" button. |
| 3 | **Download quickly** | Header *Download* only opens the panel (two steps); at ≤ 720 px tall the panel's Download button is below the fold (QA-014). | Sticky footer in the panel for the CTA. |
| 4 | **Work on a short laptop (1280×560 or a 125 % zoom)** | Header 50 + toolbar 48 + footer 42 = 140 px of chrome; the stage is 420 px; the floating mini bar then sits on the subject (`$QA/desk-1280x560-4-text.png`). Footer buttons are 34 px tall (header ones 36–40). | Compact mode below 640 px height: hide the footer's "Hold to compare" and the mini bar. |
| 5 | **Keep keyboard focus while editing** | QA-007/008: toolbar re-render drops focus; menus unreachable; the shortcut dialog does not trap Tab. A keyboard-only user cannot complete File → New design. | Re-render in place (diff the toolbar), focus the first item when a menu opens, trap focus in dialogs. |
| 6 | **Find one thing in a long panel** | The Design/Resize panel body scrolls by 737 px at 1440×900 and 1063 px at 1280×560; it contains the card, two toggles, a "Compare sizes" link and 16 sizes before the custom fields. | Collapse sections (Social / Print / Custom) and pin the Custom row. |
| 7 | **Know why a click did nothing** | Locked layers ignore canvas clicks (QA-003); "Reset adjustments" does nothing (QA-001); Apps → Collage with no photos does nothing. | Toast or shake on no-ops; unlock chip on a locked layer. |
| 8 | **Recognise shapes** | Rounded rectangle thumbnail looks like Circle (QA-017); the Elements tab strip and Templates chip row are clipped at the right edge ("Frames", "New design") with a hidden scrollbar. | Fix the thumbnail; wrap chips. |
| 9 | **Trust that saving happened** | The header says "Saving…" during autosave and "On this device" afterwards; there is no time or version hint (the Ctrl+S toast "Version saved on this device" is the only one). | Show "Saved 12:41" and let the label open Version history. |
| 10 | **Add a photo to a design** | Add photo drops the picture at about half the page, centred, so the person has to resize it (`$QA/ex6-a.png`: a 480×640 photo on a 1080 square). | Place at "cover" size for the first photo on an empty page, "fit inside" otherwise. |

At 1280×720 and 1366×768 nothing overlaps or leaves the window except the items above. At 1024×600 the toolbar loses 9 buttons (Lists, Spacing, Effects… Delete) when text is selected.

---

## 4. Accessibility quick pass (`tests/qa/a11y.js`)

**Keyboard-only walk, 1440×900.** Tab order is logical: brand, File, name, Undo/Redo, history, performance, theme, shortcuts, Download, then the rail (12), then the selection toolbar (about 20 buttons for text), then the canvas ("Design canvas", one stop), mini bar, footer. 70 presses reached 53 distinct stops; **every stop shows a visible focus ring** (a box-shadow ring, 0 without). No focus trap in the page itself. Problems:
- QA-007 toolbar focus loss (also doubles the toolbar in the order after autosave).
- QA-008 menus not reachable; QA-011 dialog does not trap Tab.
- The canvas is one tab stop; layers cannot be selected from the keyboard (Tab/arrow cycle), only through the Layers panel. Arrow keys nudge a selected layer (works).
- A panel opened with Enter on a rail button leaves focus on the rail button; the panel content is after all 12 rail buttons in the order. A "skip to panel" would help.
- Esc works in layers: closes the File menu (focus returns to File), closes the dialog (focus returns to the previous control), deselects, then closes the panel; from inside a panel input it does not close the panel (acceptable).

**Names and roles.** No button, input or image in the shell, header, toolbar, footer, or the Design, Text, Adjust, Export, Projects and Layers panels is missing an accessible name (a case in `studio-panels` guards the rail, tab bar, header, toolbar and footer). Landmarks present: header, two `nav[Studio tools]` (rail and tab bar share a label), `aside[Tool panel]`, main, toolbars, footer, skip link. Issues: QA-002 (markup in dialog label), QA-018 (eye/lock label + pressed), QA-019 (tabs without `aria-controls`), two navs with the same label (rail and phone tab bar are never both visible, so harmless), canvas has no description of its contents.

**Contrast (computed from rendered colours, WCAG AA 4.5:1, 3:1 for large text).**

| Element | Light | Dark | Pass? |
|---|---|---|---|
| Start screen headline | 13.06 | 11.68 | yes |
| Start paragraph (on the gradient) | **4.00** | 5.51 | light fails |
| Size card title | 18.27 | 16.01 | yes |
| Size card subtitle ("1080 × 1080", 11.5 px) | **3.08** | **4.30** | both fail |
| "or drop photos anywhere · paste with Ctrl V" (12.5 px) | **2.20** | **3.14** | both fail |
| Panel eyebrow ("TYPE & FONT COMBINATIONS", 10.5 px) | **3.08** | **4.30** | both fail |
| Gold primary ink on gold (Open a photo, Download) | 8.22 | 8.22 | yes |
| Ghost buttons | 14.31 | 9.77 | yes |
| Rail labels | 5.49 | 5.49 | yes |
| Brand "Studio", save status | 9.42 / 5.49 | same | yes |
| Panel title, notes, section titles, toolbar buttons | 5.6 – 18.3 | 7.55 – 16.0 | yes |

Gold button ink on the studios, PDF studio and convert page is `rgb(42, 31, 10)` as required in both themes; on the home page it is `rgb(44, 34, 15)` (QA-009). Dark and light studio and home have no console errors.

---

## 5. Performance notes (`tests/qa/perf.js`)

Local static server, cold cache (cache disabled), no compression on the wire (gzip sizes computed), no network latency, Chromium on a shared 4-core VM that other engineers were also using, so treat times as ±30 %. "4×" = Chrome CPU throttling rate 4 (a mid phone).

| | `/` | `/studio/` |
|---|---|---|
| Requests | 5 | 25 |
| Bytes loaded, first visit | **154 KB** (74 KB gzip) | **1,144 KB** (318 KB gzip) |
| By kind | CSS 60, fonts 48, HTML 25, JS 21 | JS 927, CSS 165, fonts 48, HTML 4 |
| First contentful paint | 224 ms (4×: 352 ms) | 144 ms (4×: 148 ms) |
| Interactive (CTA / size cards clickable, `LEStudio.scene` ready) | 201 ms (4×: 432 ms) | 189 ms (4×: 477 ms) |
| Network idle | 533 ms (4×: 551) | 612 ms (4×: 805) |
| DOMContentLoaded / load | 29 / 43 ms (4×: 60 / 236) | 87 / 94 ms (4×: 282 / 300) |
| Long tasks > 50 ms | none at 1×; 2 at 4× (69, 109 ms) | none at 1×; 1 at 4× (68 ms) |

Heaviest requests, `/studio/` (raw, gzip): `le-studio.js` 142 KB (39), `le-studio-panels.js` 140 (36), `le-objects.js` 124 (31), `studio.css` 101 (19), `le-studio-color.js` 86 (23), `le-assets.js` 74 (19), `le-engine.js` 67 (17), `le-fonts.js` 65 (5), `app.css` 60 (13). `/`: `app.css` 60 (13), `jakarta-latin.woff2` 27, the HTML 25 (6), `instrument-serif-italic.woff2` 22, `app.js` 21 (7). The studio loads 20 script files in sequence at the end of `<body>` (parser-blocking, no `defer`): on a real network that is the cost, not the bytes (see roadmap 1.6 caching). The home page has no product imagery yet (1.1).

**Adding a large photo (generated 4000×3000 JPEG, 4.0 MB with noise, added to a 1080×1080 design):**

| | 1× CPU | 4× CPU |
|---|---|---|
| File chosen → layer on the page | 372 ms | 1,067 ms |
| Long tasks | 1 (123 ms) | 4 (492, 108, 58, 161 ms; 819 ms total) |
| Stored bitmap | 2400×1800 (cut from 4000×3000, QA-015) | same |
| JS heap after | 22 MB | 22 MB |
| Export PNG 1080² | 404 ms, 591 KB | 763 ms |

Interaction stays responsive (single 123 ms task); at 4× the 492 ms task is a visible jank on the first frame after adding. Opening that file with **Open a photo** (not Add) gives a 2400×1800 page and a 6.2 MB PNG on export.

---

## 6. What the suite does not cover

- Pinch zoom and two-finger rotate (CDP multi-touch not scripted), real on-screen keyboards, safe-area insets, iOS/Safari, Firefox (Chromium only).
- Web Share, install prompts, offline/service worker (blocked by the harness by design), storage manager, clipboard image write (needs permissions).
- Background-photo editing, collage builder, recipes internals, stock UI — being rebuilt; only "panel opens" cases.
- Screen-reader output (no AT available); contrast is computed, not measured on screen captures.
- True OS file drag-and-drop (a synthetic `drop` event with a `File` is used), long-press multi-select timing.
