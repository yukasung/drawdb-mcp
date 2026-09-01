# Running the project

All paths here are relative to the repo root. The one exception is registering the
server with an MCP client, which runs it from a different working directory and so
needs absolute paths.

## First run

```bash
git clone https://github.com/yukasung/drawdb-mcp.git
cd drawdb-mcp
npm install          # `prepare` builds dist/ for you
npm test             # 51 tests
```

Needs **Node >= 20.19**, npm, and — only for the browser canvas — **git**.

## Live canvas

```bash
npm run build:gui    # once: clones drawDB at the pinned SHA, builds dist/gui (~18 MB)
npm run serve        # http://127.0.0.1:4321/editor
```

`build:gui` is needed again only when `src/vendor/.upstream-sha` changes. It fails loudly
if one of the three `Workspace.jsx` patch anchors has moved upstream.

Leave the tab open. Tool calls push to it, canvas edits are written back to the `.ddb`,
and editing the file in another program pushes too.

```bash
npm run serve -- --file ./schema.ddb --serve 4000
```

Anything after `--` reaches the server, and a repeated flag's last value wins — so the
`--serve` above overrides the one baked into the script. Relative paths there resolve
from the repo root, not from where you are standing, because `npm run` moves first.

- `DRAWDB_FILE`, `DRAWDB_SERVE=1`, `DRAWDB_PORT`, `DRAWDB_GUI_DIR` do the same as the flags.
- Port already busy: the canvas is skipped with a warning, the file tools carry on.

## Headless

```bash
npm start                          # diagram.ddb in the working directory
npm start -- --file ./schema.ddb
```

Every tool works the same; there is just no canvas.

## Registering with an MCP client

This is the part that needs absolute paths — the client does not run from this directory.

```bash
claude mcp add drawdb -- node /absolute/path/to/dist/index.js \
  --file /absolute/path/to/diagram.ddb --serve
```

Drop `--serve` for headless. With it, the canvas lives and dies with the MCP server;
running `npm run serve` in its own terminal instead gives you a canvas that outlives the
session, and both talk through the same `.ddb` — so you can add `--serve` to neither, and
still get a live canvas.

## Develop

```bash
npm run dev          # tsx, no build step
npm run type-check
npm run test:watch
npm run build:all    # dist/ and dist/gui
npm run clean
```

## Checking a diagram without a browser

Ask the assistant for `export_sql` / `export_dbml`, or confirm the file opens in the real
drawdb.app: <https://drawdb.app> -> **File -> Import diagram** -> pick the `.ddb`.
`npm test` also validates written documents against drawDB's own import validator.
