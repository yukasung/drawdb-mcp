# drawdb-mcp

An MCP server that lets an AI assistant design [drawDB](https://drawdb.app) ER diagrams:
create tables, columns and foreign keys, then export SQL DDL, DBML or Markdown docs.

**The `.ddb` file is the source of truth.** Every tool reads the file, applies the change and
writes it back atomically. You can keep working the way you already do: open the file in
drawdb.app (**File → Import diagram**), edit by hand, and the next tool call picks your edits up.

Started with `--serve`, it also hosts a local drawDB canvas that mirrors the file live in both
directions — tables appear as the assistant creates them, and what you draw is written straight
back to the file. The file stays authoritative either way, so nothing is lost if you close the tab.

What this server writes is checked in CI against drawDB's *own* import validator
(`src/data/schemas.js`, vendored unmodified), so "it opens in drawDB" is a test, not a hope.

## Install

```bash
npm install
npm run build
```

Every command for building, serving and testing this checkout is in [RUNNING.md](RUNNING.md).

Register it with Claude Code:

```bash
claude mcp add drawdb -- node /absolute/path/to/dist/index.js --file /absolute/path/to/diagram.ddb
```

The file is created on first write. You can also set `DRAWDB_FILE` instead of `--file`; with
neither, it uses `diagram.ddb` in the working directory. `open_diagram` switches files mid-session.

## Live canvas

```bash
npm run build:gui   # once — clones drawDB at the pinned commit and builds it
```

Then add `--serve` to the command you registered:

```bash
claude mcp add drawdb -- node /absolute/path/to/dist/index.js \
  --file /absolute/path/to/diagram.ddb --serve
```

Open <http://127.0.0.1:4321/editor> and leave it there. Every tool call pushes to the tab, every
canvas edit is written to the file, and editing the file in another program pushes too. `--serve 4000`
picks a different port (`DRAWDB_SERVE=1` and `DRAWDB_PORT` work as env vars). If the port is busy the
canvas is skipped with a warning and the file tools carry on.

The canvas is not a fork checked into this repo: `npm run build:gui` clones
[drawdb-io/drawdb](https://github.com/drawdb-io/drawdb) at the commit `src/vendor/.upstream-sha`
pins, copies in `gui/overlay/`, and inserts three lines into `Workspace.jsx`. The build fails loudly
if any of those three anchors has moved upstream, rather than shipping a canvas that never syncs.

## Tools

### Diagram

| Tool | What it does |
| --- | --- |
| `get_diagram` | Compact outline of the schema (`format: "json"` for the raw document) |
| `set_database` | Switch dialect: `mysql`, `postgresql`, `transactsql`, `sqlite`, `mariadb`, `oraclesql`, `generic` |
| `set_title` | Rename the diagram |
| `new_diagram` | Start over, empty |
| `open_diagram` / `save_diagram_as` | Point at another file / snapshot to one |

### Structure

| Tool | What it does |
| --- | --- |
| `list_tables`, `get_table` | Inspect |
| `add_table`, `update_table`, `delete_table` | Tables (deleting one takes its foreign keys with it) |
| `add_field`, `update_field`, `delete_field` | Columns |
| `add_relationship`, `update_relationship`, `delete_relationship` | Foreign keys |
| `add_enum` … `delete_type` | PostgreSQL enums and composite types |
| `add_note` … `delete_area` | Canvas notes and subject areas |
| `auto_arrange` | Lay tables out so they do not overlap |

Tables and fields can be named or given by id — `add_field { table: "users" }` works.

### Import / export

| Tool | What it does |
| --- | --- |
| `export_sql` | CREATE TABLE DDL for any of the six dialects |
| `export_dbml` / `import_dbml` | DBML, for dbdiagram.io and `dbml-cli` |
| `import_sql` | Parse existing DDL, inferring foreign keys from `REFERENCES` |
| `export_docs` | Markdown reference with an embedded Mermaid ER diagram |
| `export_mermaid` | Just the Mermaid source |
| `export_diagram` / `import_diagram` | The whole `.ddb` document |

Every exporter takes `writeTo` to put the output in a file instead of the reply — worth using for
anything large.

## Example

> Design a blog schema on PostgreSQL: users, posts, comments and tags, with the right foreign keys,
> then give me the DDL.

The assistant calls `set_database`, a few `add_table`s, `add_relationship` for each FK,
`auto_arrange`, then `export_sql`. Open the `.ddb` in drawdb.app to see it laid out.

## Limits

- **No live sync.** The drawDB tab does not update by itself; re-import the file to see changes.
  Live sync would mean forking drawDB's frontend — see
  [anatoly-lab/drawdb-mcp](https://github.com/anatoly-lab/drawdb-mcp) for that approach.
- **No PNG/SVG.** drawDB renders images from the DOM. `export_mermaid` is the headless substitute.
- **`export_sql` does not translate types** between dialects; it renders what is stored. Use
  `set_database` for a real conversion, or keep the diagram `generic`.

## Development

```bash
npm test          # vitest: ops, store, drawDB compatibility, and the tools over real MCP
npm run type-check
npx @modelcontextprotocol/inspector node dist/index.js --file /tmp/t.ddb
```

## License

**AGPL-3.0**, inherited from drawDB. `src/vendor/` is [drawdb-io/drawdb](https://github.com/drawdb-io/drawdb)
code — the SQL and DBML codecs, the datatype tables and the layout pass — copied unmodified except
for import extensions. See [`src/vendor/UPSTREAM.md`](src/vendor/UPSTREAM.md) for the exact commit
and how to re-sync. All credit for that work belongs to the drawDB authors.
