# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # `prepare` builds dist/ automatically
npm test                 # vitest, one pass
npm run test:watch
npm run type-check       # tsc --noEmit
npm run build            # tsc -> dist/
npm run dev              # tsx src/index.ts, no build step
```

Run one file or one test:

```bash
npx vitest run test/live.test.ts
npx vitest run test/live.test.ts -t "writes a browser commit"
```

There is no linter. `npm run type-check` and `npm test` are the gates.

The browser canvas is a separate, slower build:

```bash
npm run build:gui        # clones drawDB, builds dist/gui — needed only for --serve
npm run serve            # http://127.0.0.1:4321/editor
npm start                # headless
```

`npm run serve -- --file ./x.ddb --serve 4000` — args after `--` reach the process, and a
repeated flag's **last** occurrence wins (`src/cli.ts`), because `npm run serve` already
supplies a bare `--serve`.

## Architecture

An MCP server that edits a drawDB `.ddb` diagram. Layers, outermost first:

- `src/index.ts` — argv/env, stdio transport, optionally starts the live bridge.
- `src/tools/*.ts` — one file per tool group. Zod schemas, result formatting, no diagram logic.
- `src/store.ts` — the only thing that touches the filesystem.
- `src/model/ops.ts` — pure in-place mutations over a `Diagram`. All diagram logic lives here.
- `src/vendor/**` — drawDB's own code, copied unmodified.

Tools call `store.update(d => ops.something(d, …))` and format the result. A tool that
reaches into diagram internals itself belongs in `ops.ts` instead.

### The file is the state

`DiagramStore.update()` reads the file, applies the mutation to a `structuredClone`, validates
with `diagramSchema`, and only then writes (temp file + rename). There is no in-memory
authority that can drift from disk, which is what lets a user edit the `.ddb` by hand or
re-import it in drawdb.app between tool calls. A throwing op leaves the file untouched.

Writes are serialized through a promise queue so two in-flight tool calls cannot interleave
read-modify-write.

### Vendored drawDB

`src/vendor/` is drawDB copied at the SHA in `src/vendor/.upstream-sha`, with only two
mechanical changes (`.js` import extensions, a `@ts-nocheck` header) — see
`src/vendor/UPSTREAM.md`. **Do not add logic there.** Keeping it byte-comparable is what makes
re-syncing a re-download. Bridging code goes in `src/model/` or `src/tools/`.

`test/compat.test.ts` validates written documents against drawDB's *own* import validator, so
"it opens in drawDB" is a test rather than a hope.

### Two shape mismatches this codebase bridges

- **`areas` vs `subjectAreas`** — in memory the slice is `areas`; on disk drawDB reads
  `subjectAreas`, and a file spelling it `areas` opens with every area silently gone.
  `src/model/serialize.ts` is the single bridge.
- **`relationships` vs `references`** — the document and the DBML/docs/mermaid exporters say
  `relationships`; the SQL exporters read `references`. `forSqlCodec()` in `src/tools/io.ts`
  bridges it in one place.

`normalizeDiagram` is deliberately forgiving (it feeds partial documents from the SQL and DBML
importers). Anything accepting untrusted input must validate *before* handing it over — the
live bridge checks `diagramImportSchema` first, or one malformed frame quietly normalizes a
whole schema down to empty.

### Live browser canvas (`--serve`)

`src/live/bridge.ts` serves `dist/gui` over HTTP and syncs it over a WebSocket at `/sync`.
Whole-document snapshots in both directions (`src/live/protocol.ts`), never deltas — the store
already validates whole documents.

- Tool write -> `store.onChange` -> broadcast.
- Browser commit -> validate -> `store.replace` -> broadcast to *other* tabs only, so the
  author's cursor is not reset mid-drag.
- Hand edit to the file -> **directory** watch -> broadcast. It watches the directory, not the
  file: every write is temp-plus-rename, so a path watch goes deaf after the first save.
- A joining tab adopts the file, never the reverse.
- A failed bridge (busy port) warns and continues; the file tools still work.

The GUI is **not** forked into this repo. `scripts/build-gui.mjs` clones drawDB at the pinned
SHA, copies `gui/overlay/` in, and inserts three lines into `Workspace.jsx` (anchors listed in
`src/vendor/UPSTREAM.md`). The build throws if an anchor is missing or ambiguous, so a moved
anchor is a failed build rather than a canvas that silently never syncs.

`gui/overlay/src/mcp/useMcpSync.js` is our code. It suppresses echo by *value*, not by a timing
flag: `lastSyncedRef` holds the serialization of whatever was last sent or received, and the
send effect stays quiet while current state still serializes to it.

## Conventions

- ESM throughout; relative imports carry `.js` extensions.
- Tool errors return `isError` content via `guard()` rather than throwing, so the model reads
  the message and corrects itself instead of seeing a protocol failure.
- Tables and fields are addressable by name **or** id everywhere.
- stdout is the MCP protocol channel. Log to stderr only.
- Licensed AGPL-3.0-only because of the vendored drawDB code.
