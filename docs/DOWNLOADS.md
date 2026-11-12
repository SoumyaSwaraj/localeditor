# Download policy

Set by the owner, 12 November 2026. One rule for every part of the app that fetches something large: features, on-device models, fonts, packs. Feature code does not show its own download prompts; it asks `LE.downloads`.

## The rules

1. **Do not keep asking.** Download prompts and size notes appear as rarely as possible. The app decides from how the person uses it.
2. **One setting**, in Settings and in the storage manager: "Downloading features for offline use"
   - **Automatically, as I use them** (default). Things download in the background when a feature is used or is likely to be used next. No prompt for ordinary downloads; a quiet progress chip only.
   - **Always ask first.** One short question the first time each feature needs a download; the answer is remembered.
   - **Download now:** four buttons, each showing its size once: **Basic editor**, **Basic editor + models**, **Expert editor**, **Everything** (both editors and all models).
3. **Quality first, then speed.** When there are several options for the same job (for example background-remover models), pick the best-quality one this device can run well according to `LE.support`; among equals, the faster. Never pick a faster, worse option just to save time. If the best one is not on the device yet, use the best one that is and fetch the better one in the background for next time.
4. **Small enough means all at once.** If the editor's code and built-in data (not models, not the font library) is under 25 MB to transfer, download the whole editor on the first visit instead of feature by feature. The same test is applied to Basic + Expert together.
5. **When a question is still right, ask once:** a single download above the automatic limit, a metered or data-saver connection, or not enough free space. Say the size in whole megabytes, what it is for in a few words, and remember the answer.

## Numbers

| Thing | Value |
|---|---|
| Whole-editor threshold | 25 MB transfer size |
| Automatic limit per download (auto mode, unmetered) | 60 MB |
| Metered or data-saver connection | ask above 5 MB |
| Free space | never fill past the storage manager's budget; ask if a download would |

## Contract for feature code

```
LE.downloads.mode()                      → 'auto' | 'ask'
LE.downloads.request({ id, name, bytes, kind: 'feature'|'model'|'font'|'pack', reason })
                                         → Promise<{ ok, why }>   // resolves at once when no question is needed
LE.downloads.track(id, { name, bytes })  → { progress(loaded), done(), fail(err) }   // one shared, quiet progress chip
LE.downloads.pick(options)               → the option to use now, and the one to fetch for next time
     options: [{ id, quality, speed, bytes, supportId, cached }]
LE.downloads.packs()                     → [{ id: 'basic'|'basic+models'|'expert'|'all', bytes, done, download() }]
```

Feature-detect it: when `LE.downloads` is missing, download without asking if the item is 60 MB or less and ask once otherwise.
