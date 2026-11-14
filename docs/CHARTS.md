# Charts

A chart in LocalEditor is **plain data on a group layer**. The group's children are ordinary layers (shapes and text) drawn from that data, so a chart is editable part by part, exports exactly, and needs no chart code to open, draw or print. Changing the chart ("Edit chart", or an agent's `chart.update`) redraws the children inside the group's box in one undo step. A child edited by hand is replaced when the chart is redrawn; the panel says so once.

| File | What |
|---|---|
| `assets/js/le-charts.js` | `LE.charts`: the engine. Pure functions, no dependency, also loadable with `require()` (text is then measured by estimate). 52 KB gzip, loaded only when asked. |
| `assets/js/le-studio-charts.js`, `assets/css/studio-charts.css` | The Chart panel. |
| `assets/js/makers/chartposter.js` | Quick maker "Chart poster": eyebrow, headline, chart card, note panel, source line, wordmark. |
| `tests/charts.test.js`, `tests/charts-ui.test.js` | Engine and panel tests. |

## The data model

```json
{ "id": "seats", "type": "group", "name": "Seats by room", "x": 90, "y": 200, "w": 900, "h": 560,
  "chart": {
    "v": 1,
    "type": "bar",
    "data": { "columns": ["Room", "Seats"], "rows": [["Hall", 620], ["Lounge", "450"]] },
    "map": { "category": 0, "series": [1] },
    "theme": "paper",
    "options": { "title": "Seats by room", "highlight": "Hall", "sort": "desc" }
  } }
```

- **`data`**: column names and rows of cells. A cell is text or a number. Cells are never evaluated: `=SUM(A1:A9)` is the text `=SUM(A1:A9)`. Numbers may carry what a spreadsheet shows: `1,200`, `$1,234.50`, `45%`, `70 feet`, `(300)`, `1.2K`, `12,5`. The unit, currency sign and decimals of a column are kept in labels.
- **`map`**: which column plays which part, as a column index or its name: `category` (labels; `-1` = row numbers), `series` (number columns), `group` (a second label column of a long table: one series per value), `x`, `y`, `size` (scatter, bubble), `target` (bullet, gauge). Left out, columns are mapped by what they hold.
- **`theme`**: a theme id (below). **`options`**: plain values (below).
- **Limits**: 60 columns, 5,000 cells, text cells 200 characters, options and map 40 keys and four levels deep. Enforced by `LE.Scene.chartOf` (load, undo, `.leproject` import through `le-project.js`), by the open format (`le-design.js`, `schema/design-1.json`) and again by the engine. Larger imports are reduced first by `LE.charts.fit`: rows that share a label are added up; otherwise rows are sampled evenly. Either way a note says what happened.
- **In a design file** a chart group may come without children: `{ "type": "group", "x", "y", "w", "h", "chart": { … } }`. The reader draws them (with the theme's fonts loaded) when the file is read, so `build`, `render`, `check` and the studio all see ordinary layers. A file written by the studio has both the data and the layers.
- Children are named for what they are ("Hall", "Value", "Gridline", "Legend") and have ids `<group id>.<n>`. Curved and many-sided parts (lines, areas, slices, radar shapes) are `polyline` shapes with unit points; everything else is rectangles, ellipses and text.

## API (`LE.charts`)

```js
build(chart, box, ctx) → layers[]            // box { x, y, w, h } in page px; ctx { id (group id), brand, background, measure }
render(chart, box, ctx) → { layers, notes, info, theme }   // notes: plain sentences; info: scale { k, zero, axis }, bars, angles, texts
types() → [{ id, name, group, needs, options }]        themes(ctx) / theme(id, ctx) → theme data
suggest(table) → ranked [{ type, map, options, why, score }]    summary(chart) → a sentence or two (alt text)
sample(type, theme) → a chart with example data        catalog() → types, themes, options, example operations
fromTable(table) → data      fit(data) → { data, note }      analyse(data) → column kinds      prepare(chart) → what is drawn
format(value, { pre, suf, dec }, compact)    ticks(min, max, count)    scale.linear | log | time | band    number(cell)    date(cell)
ready(chart, ctx) → Promise                  // loads the theme's fonts so text is measured exactly
regenerate(page, groupId, ctx) → { layers, notes }     expand(page, ctx)     // draw chart groups that have no children
ops.apply(page, op, ctx) → { ok, doc, id, summary, warnings | errors }
color.contrast | ensure | simulate(colour, 'protan' | 'deutan' | 'tritan') | distance
```

`build` is synchronous and deterministic. Call `ready` first in a browser; without the fonts the layout is still valid but measured with a fallback font.

## Chart types

Every type takes the common options: `title`, `subtitle`, `note`, `source`, `highlight` (a label or series name, or a list), `sort` (`asc` / `desc`), `top` (N, the rest becomes "Other"), `aggregate` (`sum` `mean` `count` `min` `max` for rows with the same label), `exclude` (labels left out), `swap` (rows ↔ columns), `labels` (`off` / `on`), `legend` (`on`), `card` (`false` = no background; text is then coloured for `ctx.background`), `textScale` (0.6–1.8), `unit`, `prefix`, `decimals`, `annotations`.

| Type | Needs | Its options | Notes |
|---|---|---|---|
| `bar` | labels + number columns | `mode` (`stacked`, `percent`), `labelsAt` (`left`, `above`), `labelPosition` (`inside`), `axis`, `gap` | Horizontal. Drawn to scale from zero. One series: direct value labels, no axis. |
| `column` | labels + number columns | `mode`, `axis`, `gap` | Vertical. Value labels when they fit, else a light axis. |
| `line` | dates or ordered labels + number columns | `smooth`, `markers`, `zero` (`false`), `legend` | Lines are labelled at their ends when that fits. Real dates are spaced in time. |
| `area` | as line | `mode` (`stacked`, `percent`), `smooth` | Always from zero. |
| `pie`, `donut` | labels + one number column above zero | `show` (`value`), `fold` (`false`), `hole`, `centre` | Leader lines outside, percent inside when it fits; slices under 3 % fold into "Other"; the donut shows the total. |
| `scatter`, `bubble` | `map.x`, `map.y` (+ `map.size`) | `trend`, `logX`, `logY` | Least-squares trend line; up to 250 points (evenly sampled, with a note). |
| `histogram` | one number column | `bins` | Automatic bins with round edges (Freedman–Diaconis, then a nice step). |
| `combo` | labels + two or more number columns | `line` (series name), `smooth` | Columns on the left axis, a line on the right; both axes labelled in words and colour; shared gridlines. |
| `waterfall` | labels + gains and losses | `total` (`false`), `totalLabel`, `start` | Signed labels; a total bar at the end. |
| `funnel` | stages + one number column | | Centred bars to scale, share of the first stage on the right. |
| `radar` | 3–12 rows + up to 6 number columns | | |
| `gauge` | one number (+ `map.target` or `max`) | `shape` (`ring`), `max` | Up to 8 rows as small gauges. |
| `lollipop` | labels + number columns | `stem` (`false`) | Without stems it is a dot plot; several columns draw a range. |
| `slope` | labels + two number columns | | Labels at both ends, moved apart when they would touch. |
| `bullet` | labels + value + `map.target` | | Value bar, target tick, "82 / 75". |
| `heatmap` | rows + number columns | | Sequential ramp, diverging when values cross zero; values printed when they fit. |
| `treemap` | labels + one number column | | Squarified; largest first. |
| `pictogram` | labels + one number column | `icon`, `per`, `max` | Rows of icons with a key ("= 2 each"); one percentage makes a 10 × 10 grid. |
| `stat` | label + number (+ change) | `changeLabel` | Big-number tiles with a signed change. |
| `sparkline` | a row per thing + number columns across | | A small line, the last value and the change per row. |
| `table` | any rows | `zebra` (`false`) | Numbers right-aligned; shows as many rows as fit and says how many. |

### Rules the engine keeps

- **Bars are drawn to scale**: every bar's length is its value × one constant (`info.scale.k`), from a zero line. `zero: false` is refused for bars with a note. Lines may start above zero (`zero: false`); the axis then carries a break mark and the chart says "The vertical axis starts at …, not zero."
- **Direct labels before legends**: values on bars, names at line ends, names beside slices. A legend appears only when direct labels do not fit.
- **Text never overlaps.** Every placed label is recorded; optional labels (values, tick labels at the edges) are left out if they would touch another. Axis labels are tried flat, then on two lines, then turned 40°, then thinned to every n-th. Long names are shortened with "…". Tick labels are abbreviated (1,200 → 1.2K) when the full form does not fit; a one-character unit rides on every tick, a word only on the top one.
- **Every label reaches 4.5:1** against what is behind it (the card, a bar, a tile): the colour asked for is pushed towards black or white until it does.
- **Highlight**: the named category or series takes the theme's accent, everything else recedes to its neutral.
- **Gap marker** (`gap: { from, to, label, note }` on single-series bars and columns): a dashed box from the shorter bar's end to the longer bar's length, with the difference inside and a line under it. `{diff}`, `{percent}`, `{from}`, `{to}` are filled in; the percent is of `from`.
- **Annotations** (`annotations`, up to 8): `{ "type": "line", "value": 200, "label": "Target" }`, `{ "type": "band", "from": 150, "to": 250, "label": "Usual range" }`, `{ "type": "callout", "category": "Jun", "series": "Sales", "text": "New shop" }`. `title`, `subtitle`, `note` and `source` are text options.
- **Any size**: text size follows the box (`min(w / 30, h / 15)`, 8–40 px); rows, ticks and labels are laid out again for whatever box the group has.
- **Layer budget**: a chart is at most 420 layers; types cap their own rows and say so.

## Themes

Plain data in `le-charts.js` (`THEMES`): `page`, `card`, `border`, `ink`, `muted`, `grid`, `axis`, `accent`, `neutral`, `palette` (8 categorical), `seq` (light → dark), `div` (low, middle, high), `up` / `down`, `head` / `body` (library families) with `hw` / `vw` weights, `radius`, `cardRadius`, `panel`.

| id | Name | Fonts | Character |
|---|---|---|---|
| `clean` | Clean | Inter | The neutral default: white card, blue accent, light grey for the rest. |
| `paper` | Paper | Lato + Lexend | Warm paper, orange accent, slate bars. |
| `dark` | Dark | Manrope | Charcoal card, light blue accent. |
| `contrast` | High contrast | Atkinson Hyperlegible | Black on white, square corners, 2 px border. |
| `mono` | One accent | IBM Plex Sans | Greys and one red-orange. |
| `pastel` | Pastel | Nunito | Soft colours, round corners. |
| `grey` | Print grey | Source Serif 4 + Source Sans 3 | Greyscale only; pale fills get a hairline outline. |
| `vivid` | Bold | Space Grotesk + Inter | Saturated violet, pink, cyan. |
| `brand` | My brand | the brand's | Colours and fonts from the design's brand block (`meta.studio.brand`, `docs/FORMAT-BRAND.md`) or the studio Brand kit; without one it is `clean`. Brand colours join the palette only while every pair stays apart; the rest is filled from the default palette and greys. |

Checked in `tests/charts.test.js`: every pair of palette colours is at least 7 apart (OKLab × 100; the closest pair of the Okabe–Ito palette is 7.6) in normal vision and under protanopia and deuteranopia simulation (Machado et al. 2009), 4.9 under tritanopia; every text layer of every type in every theme, with and without the card, reaches 4.5:1; every font and weight is in the library.

## Data to chart: `suggest`

`suggest(table)` reads what each column holds (`analyse`: `number`, `percent`, `currency`, `date`, `category`, `text`, with the cells that do not fit) and the table's shape, and answers with ranked, already-mapped charts, each with one reason.

| Table | First suggestion | Also |
|---|---|---|
| dates + one number | `line` ("12 months of one number: a line shows the trend.") | column, area |
| dates + several numbers | `line`; `combo` first when there are two different units | stacked area, column, heatmap |
| labels + one number | `bar`, sorted | column, lollipop (many rows), donut, treemap, pictogram |
| labels + percentages adding up to 100 | `donut` | pie, bar |
| stages, each smaller than the last | `funnel` | bar |
| labels + gains and losses | `waterfall` | bar |
| labels + value + a column named target / goal / budget… | `bullet` | |
| labels + two columns in the same unit named like two moments | `slope` | grouped bar, dot plot |
| labels + two different measures | `scatter` | combo |
| labels + many number columns | `heatmap` (over 20 cells), `sparkline` (5 or more columns) | grouped and stacked bars, radar |
| a long table (label, label, number) | pivoted: grouped `column`, or `line` when the first is dates | stacked bar, heatmap |
| two or three number columns, no labels | `scatter`, `bubble` | |
| one number column, 20 or more rows | `histogram` | |
| one row | `stat`, `gauge` for a percentage | |
| no numbers | `bar` counting a repeated label, else `table` | |

A first row that is all numbers is treated as data (columns become "Column 1"…). A table always comes last as a fallback.

## The Chart panel

Elements → **Chart from your numbers**, Apps → **Chart**, `?tool=chart`, or the **Edit chart** chip when a chart group is selected.

1. **Data**: paste cells from a spreadsheet, choose or drop a `.csv` / `.tsv` / `.xlsx` (through `LE.variables.parseFile`; a sheet picker for workbooks; SheetJS loads only when an Excel file is chosen), or **Type it here** (a table on wide screens, one card per row on a phone). Or tap any of the 23 types to try it with example data.
2. **Charts that fit this data**: what was read in words, cells that are not numbers with **Fix here**, and the suggestions as live thumbnails with their reasons. One tap puts the chart on the page.
3. **Edit**: *Highlight one* (one tap), *Theme*, options for the type, *Chart type* (live thumbnails of this data); **Data**: edit the numbers, use other data, what goes where (labels, numbers, split by, target), rows with the same label, top N + Other, swap rows and columns, rows shown; **Words**: title, line under it, note, source, unit, a reference line, and the chart in a sentence (copy as alt text).

Data stays on the device. Nothing of this loads until the panel is asked for; a design that contains a chart draws without it.

## Agents

In agent mode (`window.LEAgent`, one undo step per batch) and on design files (`localeditor apply`, the live link):

```js
{ "op": "chart.add", "type": "bar", "data": { "columns": ["Room", "Seats"], "rows": [["Hall", 620], ["Lounge", 450]] },
  "theme": "paper", "options": { "title": "Seats by room", "highlight": "Hall" }, "box": { "x": 90, "y": 200, "w": 900, "h": 560 }, "id": "seats" }
{ "op": "chart.add", "csv": "Month,Sales\nJan,420\nFeb,380" }            // no type: the best fit for the data
{ "op": "chart.update", "layer": "seats", "type": "column", "theme": "dark", "options": { "sort": "desc", "highlight": null } }
{ "op": "chart.data", "layer": "seats", "rows": [["Hall", 640], ["Lounge", 455]], "columns": ["Room", "Seats"] }
```

- `data` is `{ columns, rows }`; `rows` alone may be arrays (first row = names) or objects; `csv` is read by `LE.variables.parseCSV`.
- `chart.update` merges `options` (`null` removes one) and replaces `type`, `theme`, `map`, `box`. `chart.data` keeps the mapping when the column names still match.
- Each answers with `summary` (the chart in a sentence), `warnings` (the engine's notes) and the group's id.
- `LEAgent.catalog("charts")` lists types with their options, themes, the mapping keys and example operations. `LE.charts.suggest(table)` and `LE.charts.summary(chart)` are plain functions an agent can call first.
- On a file (`LE.link.applyOps`) the operation changes the group's data and drops the drawn layers; the next read draws them. So a design file can simply contain `{ "type": "group", "chart": { … } }`.

## Chart poster (`?make=chartposter`)

Inputs: small line above, headline, numbers (label, value), chart (bars, columns, line, donut), highlight, numbers inside the bars, the gap between the first two rows with its words, a two-line note panel, source line, your name. Styles: Paper, Clean, Dark, One accent, Bold, Print grey. Sizes: Wide 1600 × 1000, Square, Portrait 4:5, Slide 1920 × 1080. The chart on the made page is a chart group, so **Edit chart** works on it.

## Not done

- No time axis with tick marks at round dates: dates are spaced in time, labelled with the given labels (ISO dates are shortened to "5 Jan" / "Jan 24").
- No second level in treemaps, no error bars, no box plot, no maps.
- A resized chart group scales its children like any group; it is laid out afresh the next time the chart is edited.
- `localeditor catalog charts` is not wired in the command line's own catalogue (`tools/le-cli/lib/page-adapter.js`); `LEAgent.catalog("charts")` answers in the browser.
