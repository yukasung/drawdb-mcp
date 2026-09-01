# Running the project

Commands for this checkout: `/Users/chainarong.j/Projects/DrawdbMCP/Project`,
diagram file `/Users/chainarong.j/Projects/DrawdbMCP/diagrams/main.ddb`.

## Build

```bash
npm install
npm run build          # TypeScript -> dist/
npm run build:gui      # clones drawDB at the pinned SHA and builds dist/gui — needed for --serve
npm run build:all      # both
```

`build:gui` is only needed once, and again whenever `src/vendor/.upstream-sha` changes.
It fails loudly if one of the three `Workspace.jsx` patch anchors has moved upstream.

## Live canvas

```bash
node dist/index.js \
  --file /Users/chainarong.j/Projects/DrawdbMCP/diagrams/main.ddb \
  --serve

open http://127.0.0.1:4321/editor
```

Leave the tab open. Tool calls push to it, canvas edits are written back to the `.ddb`,
and editing the file in another program pushes too.

- `--serve 4000` — different port. `DRAWDB_SERVE=1` and `DRAWDB_PORT` work as env vars.
- `DRAWDB_GUI_DIR` — serve a GUI build from somewhere other than `dist/gui`.
- Port already busy: the canvas is skipped with a warning, the file tools carry on.

Running this alongside the MCP server registered in `.mcp.json` works without changing that
config — both processes talk through the same `.ddb`, and the bridge watches the directory.
A canvas started this way outlives the Claude Code session.

To skip the separate terminal instead, add `--serve` to the `args` in `.mcp.json`. The canvas
then lives and dies with the MCP server.

## Headless (no browser)

```bash
node dist/index.js --file /path/to/diagram.ddb
```

What `.mcp.json` registers today. Every tool works the same; there is just no canvas.

```bash
claude mcp add drawdb -- node /Users/chainarong.j/Projects/DrawdbMCP/Project/dist/index.js \
  --file /Users/chainarong.j/Projects/DrawdbMCP/diagrams/main.ddb --serve
```

## Develop

```bash
npm run dev            # tsx, no build step
npm run type-check
npm test               # vitest, one pass
npm run test:watch
npm run clean
```

## Checking a diagram without opening a browser

Ask the assistant for `export_sql` / `export_dbml`, or check the file opens in the real
drawdb.app: <https://drawdb.app> -> **File -> Import diagram** -> pick the `.ddb`.
`npm test` also validates written documents against drawDB's own import validator.
