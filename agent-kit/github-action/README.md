# GitHub Action: design check

Keeps the designs in a repository honest. On a pull request it:

1. finds the `.ledesign.json` files the pull request changed (all of them when a brand file changed),
2. draws every page with the real LocalEditor engine in the runner's own headless browser,
3. checks each design: overflowing text, layers off the page, low contrast, missing images, unknown fonts, and the brand (colours, fonts, contrast, logo size and clear space) when the design names one or you pass `brand`,
4. uploads the pictures and a `report.json` as one artifact,
5. writes a job summary: a table of designs, pages, picture names, problem counts and what changed (layers added, removed, changed), then the problems one by one,
6. fails the job when there are more problems than `max-warnings`.

Nothing leaves the runner except the artifact. The engine cannot reach the network. No secrets and no permissions beyond reading the repository.

## Use it

Copy `examples/github/design-check.yml` to `.github/workflows/design-check.yml`:

```yaml
name: Design check
on:
  pull_request:
    paths: ['**/*.ledesign.json', '**/*.lebrand.json', '**/*.design.js']
permissions:
  contents: read
jobs:
  designs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: SoumyaSwaraj/localeditor/agent-kit/github-action@main
        with:
          brand: brand.lebrand.json
```

It uses three actions and no others: `actions/checkout` (in your workflow), `actions/setup-node` and `actions/upload-artifact` (inside this one).

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `files` | `**/*.ledesign.json` | Designs to build and check. One pattern per line or comma-separated. |
| `scripts` | *(none)* | Design scripts to run with Node, for example `**/*.design.js` (`docs/DESIGN-AS-CODE.md`). A script is code from the pull request: leave this empty for pull requests you do not trust. |
| `brand` | *(none)* | A brand file to check every design against. Without it each design's own `"brand"` is used. |
| `changed-only` | `true` | Only the designs the pull request changed. `false` builds all. |
| `base` | the pull request's base commit | What to compare with. |
| `format` | `png` | `png`, `jpg`, `webp`, `pdf`, comma-separated. |
| `max-warnings` | `0` | Problems allowed before the job fails. |
| `fail-on-problems` | `true` | `false` reports without failing. |
| `artifact-name` | `localeditor-previews` | The artifact's name. |
| `node-version` | `20` | Node 20 or later. |
| `browser` | *(found on the runner)* | Path to Chrome, Edge or Chromium. |

Outputs: `designs` (count), `problems` (count), `previews` (the folder).

## Notes

- **Use `pull_request`, never `pull_request_target`.** The job reads files from the pull request; it must not run with your secrets.
- `fetch-depth: 0` lets the action see the base commit. Without it every design is built and the summary says so.
- Pictures are named after the design's path: `social/launch.ledesign.json` → `social--launch.png`, or `social--launch-0.png`, `-1.png` … for several pages.
- Text from the designs is escaped before it goes into the summary.
- GitHub's Ubuntu runners come with Chrome. On another runner install Chrome, Edge or Chromium and pass `browser`.
- The same step runs on your machine: `LE_CHANGED_ONLY=false node agent-kit/github-action/run.js` in a folder with designs writes `localeditor-previews/` and prints the summary.

This action was tested locally with the script above (`tests/design-code.test.js`); it has not yet been run on a hosted runner from this repository.
