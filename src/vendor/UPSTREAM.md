# Vendored upstream code

Everything under `src/vendor/` except the two files marked `SHIM (not upstream code)`
is copied from **[drawdb-io/drawdb](https://github.com/drawdb-io/drawdb)**, licensed
**AGPL-3.0**. That license is why this package is AGPL-3.0 too.

- Upstream commit: `5efc5fd10a27241f0844dfd31efff4a9e53a61fb`
- Copied on: 2026-09-01
- Source path mapping: `src/<path>` upstream -> `src/vendor/<path>` here.

## What was changed

1. `.js` extensions added to every relative import (upstream is bundled by Vite,
   which resolves extension-less specifiers; Node ESM does not).
2. A `// @ts-nocheck` header, so `allowJs` compilation does not type-check
   someone else's code.

**No logic was modified.** Keeping it that way is what makes re-syncing with
upstream a re-download plus a re-run of the import rewrite.

## Shims (written here, not upstream)

- `i18n/i18n.js` — upstream boots i18next with a browser language detector.
  The exporters only call `i18n.t()` on `Cardinality` constants and compare the
  result against `i18n.t()` of the same constants, so an identity `t` is correct
  for a headless server.
- `data/databases.js` — upstream ships React icon components in the same object
  as the capability flags. This keeps the flags and `name`, drops the icons.

## The browser canvas

`scripts/build-gui.mjs` clones the **same commit** and builds drawDB's React app; none of it is
checked in here. On top of the clone it copies `gui/overlay/` (our code, not upstream's) and
inserts three lines into `src/components/Workspace.jsx`:

| Anchor | Inserted |
| --- | --- |
| the `react-i18next` import | `import useMcpSync, { isMcpSync } from "../mcp/useMcpSync";` |
| `const loadedIdRef = useRef(null);` | `useMcpSync({ title, setTitle });` |
| `const load = useCallback(async () => {` | `if (isMcpSync()) return;` |

The third one matters: without it the editor restores its own IndexedDB copy on mount and races
the first snapshot from the server. The build throws if an anchor is missing or matches twice, so
a moved anchor is a failed build rather than a canvas that quietly never syncs.

## Re-syncing

```bash
SHA=<new upstream sha>
# re-download the same file list, then re-run the import-extension rewrite
```

Bumping `.upstream-sha` moves the GUI build too — re-run `npm run build:gui` and confirm the three
patch anchors still apply.
