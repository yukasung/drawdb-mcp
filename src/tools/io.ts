import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { DATABASE_IDS, DB, type DatabaseId } from "../model/constants.js";
import { DrawdbError } from "../model/errors.js";
import { normalizeDiagram } from "../model/normalize.js";
import { toFileFormat } from "../model/serialize.js";
import { diagramImportSchema, type Diagram } from "../model/schemas.js";
import { arrangeTables } from "../vendor/utils/arrangeTables.js";
import { toDBML } from "../vendor/utils/exportAs/dbml.js";
import { jsonToDocumentation } from "../vendor/utils/exportAs/documentation.js";
import { jsonToMermaid } from "../vendor/utils/exportAs/mermaid.js";
import {
  jsonToMariaDB,
  jsonToMySQL,
  jsonToOracleSQL,
  jsonToPostgreSQL,
  jsonToSQLite,
  jsonToSQLServer,
} from "../vendor/utils/exportSQL/generic.js";
import { exportSQL } from "../vendor/utils/exportSQL/index.js";
import { fromDBML } from "../vendor/utils/importFrom/dbml.js";
import { importSQL } from "../vendor/utils/importSQL/index.js";
import { guard, outline, saved, text, type ToolContext, type ToolResult } from "./helpers.js";

/**
 * A `generic` diagram stores portable types, so rendering it needs the
 * per-dialect converters rather than `exportSQL`, which returns "" for
 * generic. Same split upstream makes in its export dialog.
 */
const GENERIC_EXPORTERS: Record<string, (d: unknown) => string> = {
  [DB.MYSQL]: jsonToMySQL,
  [DB.POSTGRES]: jsonToPostgreSQL,
  [DB.SQLITE]: jsonToSQLite,
  [DB.MARIADB]: jsonToMariaDB,
  [DB.MSSQL]: jsonToSQLServer,
  [DB.ORACLESQL]: jsonToOracleSQL,
};

/**
 * The SQL exporters read the foreign keys off `diagram.references`, while the
 * document (and the DBML/docs/mermaid exporters) call the same list
 * `relationships`. Upstream bridges the two at every call site by spreading
 * `references: relationships` in; do it in one place instead.
 */
function forSqlCodec(d: Diagram): Record<string, unknown> {
  return { ...d, references: d.relationships };
}

async function deliver(body: string, writeTo: string | undefined, label: string): Promise<ToolResult> {
  if (!writeTo) return text(body);
  const path = resolve(writeTo);
  await writeFile(path, body.endsWith("\n") ? body : `${body}\n`, "utf8");
  return text(`Wrote ${label} to ${path} (${body.split("\n").length} lines).`);
}

/** Accept either inline source or a path, so large dumps do not have to pass through the context. */
async function readSource(inline: string | undefined, path: string | undefined, what: string): Promise<string> {
  if (inline && path) throw new DrawdbError(`Pass either ${what} or path, not both.`);
  if (inline) return inline;
  if (path) return readFile(resolve(path), "utf8");
  throw new DrawdbError(`Nothing to import — pass ${what} or path.`);
}

export function registerIoTools({ server, store }: ToolContext): void {
  const writeToArg = z
    .string()
    .optional()
    .describe("Write the output to this file instead of returning it. Useful for large schemas.");

  // ------------------------------------------------------------- export ---

  server.registerTool(
    "export_sql",
    {
      title: "Export SQL DDL",
      description:
        "Generate CREATE TABLE DDL for the diagram. Defaults to the diagram's own dialect; a `generic` " +
        "diagram requires an explicit dialect because its types are portable placeholders.",
      inputSchema: {
        dialect: z
          .enum(DATABASE_IDS as [string, ...string[]])
          .optional()
          .describe(`Target dialect. One of: ${DATABASE_IDS.join(", ")}`),
        writeTo: writeToArg,
      },
    },
    async ({ dialect, writeTo }) =>
      guard(async () => {
        const d = await store.read();
        const target = (dialect ?? d.database) as DatabaseId;

        if (target === DB.GENERIC) {
          throw new DrawdbError(
            `"generic" is not a SQL dialect. Pass dialect= one of: ${Object.keys(GENERIC_EXPORTERS).join(", ")}`,
          );
        }

        let sql: string;
        let note = "";
        if (d.database === DB.GENERIC) {
          sql = GENERIC_EXPORTERS[target](forSqlCodec(d));
        } else {
          if (target !== d.database) {
            note =
              `\n-- NOTE: the diagram's dialect is ${d.database}; this was rendered as ${target}. ` +
              `Column types were NOT translated — set_database first if you want a real conversion.\n`;
          }
          sql = exportSQL({ ...forSqlCodec(d), database: target });
        }

        if (!sql.trim()) throw new DrawdbError(`Nothing to export — the diagram has no tables.`);
        return deliver(note + sql, writeTo, `${target} DDL`);
      }),
  );

  server.registerTool(
    "export_dbml",
    {
      title: "Export DBML",
      description: "Render the diagram as DBML (the dbdiagram.io / dbml-cli format).",
      inputSchema: { writeTo: writeToArg },
    },
    async ({ writeTo }) =>
      guard(async () => {
        const d = await store.read();
        return deliver(toDBML(d), writeTo, "DBML");
      }),
  );

  server.registerTool(
    "export_docs",
    {
      title: "Export Markdown documentation",
      description:
        "Markdown reference for the schema: a table-of-contents, one section per table with its columns, " +
        "indexes and relationships, and an embedded Mermaid ER diagram.",
      inputSchema: { writeTo: writeToArg },
    },
    async ({ writeTo }) =>
      guard(async () => {
        const d = await store.read();
        return deliver(jsonToDocumentation(d), writeTo, "documentation");
      }),
  );

  server.registerTool(
    "export_mermaid",
    {
      title: "Export Mermaid ER diagram",
      description:
        "Just the Mermaid `erDiagram` source. Paste into any Markdown renderer that supports Mermaid to get a " +
        "picture — this server is headless, so it cannot produce PNG/SVG the way the drawDB GUI does.",
      inputSchema: { writeTo: writeToArg },
    },
    async ({ writeTo }) =>
      guard(async () => {
        const d = await store.read();
        return deliver(jsonToMermaid(d), writeTo, "Mermaid");
      }),
  );

  server.registerTool(
    "export_diagram",
    {
      title: "Export .ddb JSON",
      description:
        "The full diagram document — the same JSON drawDB's File > Export > JSON produces. Use writeTo to " +
        "drop a .ddb file somewhere for import into drawdb.app.",
      inputSchema: { writeTo: writeToArg },
    },
    async ({ writeTo }) =>
      guard(async () => {
        const d = await store.read();
        return deliver(JSON.stringify(toFileFormat(d), null, 2), writeTo, ".ddb JSON");
      }),
  );

  // ------------------------------------------------------------- import ---

  const modeArg = z
    .enum(["replace", "merge"])
    .optional()
    .describe("replace (default) discards the current diagram; merge appends to it.");

  server.registerTool(
    "import_sql",
    {
      title: "Import SQL DDL",
      description:
        "Parse existing CREATE TABLE statements into the diagram, inferring foreign keys from REFERENCES " +
        "clauses and laying the tables out automatically.",
      inputSchema: {
        sql: z.string().optional().describe("SQL source. Alternatively pass path."),
        path: z.string().optional().describe("Read the SQL from this file instead."),
        dialect: z
          .enum(Object.keys(GENERIC_EXPORTERS) as [string, ...string[]])
          .describe(`Dialect the SQL is written in. One of: ${Object.keys(GENERIC_EXPORTERS).join(", ")}`),
        mode: modeArg,
      },
    },
    async ({ sql, path, dialect, mode }) =>
      guard(async () => {
        const source = await readSource(sql, path, "sql");
        const current = await store.read();
        const ast = await parseSql(source, dialect as DatabaseId);

        let imported: any;
        try {
          imported = importSQL(ast, dialect, current.database);
        } catch (error) {
          throw new DrawdbError(
            `The SQL parsed but could not be turned into a diagram: ${(error as Error).message}`,
          );
        }

        const next = mergeOrReplace(current, imported, mode);
        const diagram = await store.replace(next, current.database as DatabaseId);
        return saved(
          store,
          `Imported ${diagram.tables.length} table(s) and ${diagram.relationships.length} relationship(s) from ${dialect} SQL.`,
        );
      }),
  );

  server.registerTool(
    "import_dbml",
    {
      title: "Import DBML",
      description: "Parse a DBML schema into the diagram.",
      inputSchema: {
        dbml: z.string().optional().describe("DBML source. Alternatively pass path."),
        path: z.string().optional().describe("Read the DBML from this file instead."),
        mode: modeArg,
      },
    },
    async ({ dbml, path, mode }) =>
      guard(async () => {
        const source = await readSource(dbml, path, "dbml");
        const current = await store.read();

        let imported: any;
        try {
          imported = fromDBML(source, current.database);
        } catch (error) {
          throw new DrawdbError(`Could not parse the DBML: ${(error as Error).message}`);
        }

        const next = mergeOrReplace(current, imported, mode);
        const diagram = await store.replace(next, current.database as DatabaseId);
        return saved(
          store,
          `Imported ${diagram.tables.length} table(s) and ${diagram.relationships.length} relationship(s) from DBML.`,
        );
      }),
  );

  server.registerTool(
    "import_diagram",
    {
      title: "Import .ddb JSON",
      description:
        "Load a whole diagram document — a .ddb file exported from drawdb.app, or inline JSON. Replaces " +
        "everything, including the dialect.",
      inputSchema: {
        json: z.string().optional().describe("The document as a JSON string. Alternatively pass path."),
        path: z.string().optional().describe("Read the .ddb from this file instead."),
      },
    },
    async ({ json, path }) =>
      guard(async () => {
        const source = await readSource(json, path, "json");

        let parsed: unknown;
        try {
          parsed = JSON.parse(source);
        } catch (error) {
          throw new DrawdbError(`Not valid JSON: ${(error as Error).message}`);
        }

        const checked = diagramImportSchema.safeParse(parsed);
        if (!checked.success) {
          const issue = checked.error.issues[0];
          throw new DrawdbError(
            `That does not look like a drawDB document — ${issue.path.join(".") || "(root)"}: ${issue.message}`,
          );
        }

        const diagram = await store.replace(checked.data);
        return saved(store, `Imported diagram.\n\n${outline(diagram)}`);
      }),
  );

  // ------------------------------------------------------------- layout ---

  server.registerTool(
    "auto_arrange",
    {
      title: "Auto-arrange tables",
      description:
        "Lay the tables out on a grid so nothing overlaps — the same pass the importers run. Call it after " +
        "adding a batch of tables that all defaulted to (0,0).",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const { diagram } = await store.update((d) => {
          arrangeTables(d);
        });
        return saved(store, `Arranged ${diagram.tables.length} table(s).`);
      }),
  );
}

/** Parser setup transcribed from upstream's `Modal.jsx` import path. */
async function parseSql(source: string, dialect: DatabaseId): Promise<unknown> {
  try {
    if (dialect === DB.ORACLESQL) {
      const { Parser: OracleParser } = await import("oracle-sql-parser");
      return new OracleParser().parse(source);
    }
    // node-sql-parser is CJS: the named export is on the default binding.
    const sqlParser = await import("node-sql-parser");
    const { Parser } = (sqlParser as unknown as { default: typeof sqlParser }).default ?? sqlParser;
    return new Parser().astify(source, { database: dialect });
  } catch (error) {
    const err = error as Error & { location?: { start: { line: number; column: number } } };
    const where = err.location
      ? ` [line ${err.location.start.line}, col ${err.location.start.column}]`
      : "";
    throw new DrawdbError(`SQL syntax error${where}: ${err.message}`);
  }
}

function mergeOrReplace(current: Diagram, imported: any, mode: string | undefined): unknown {
  if (mode !== "merge") {
    return {
      ...imported,
      database: current.database,
      // The importers only emit tables/relationships/types/enums. Notes and
      // areas are cleared, matching what upstream's "overwrite" import does —
      // furniture positioned around the old tables would be meaningless
      // against a new schema.
      notes: [],
      areas: [],
    };
  }

  const merged = normalizeDiagram(
    {
      ...current,
      tables: [...current.tables, ...(imported.tables ?? [])],
      relationships: [...current.relationships, ...(imported.relationships ?? [])],
      enums: [...current.enums, ...(imported.enums ?? [])],
      types: [...current.types, ...(imported.types ?? [])],
    },
    current.database as DatabaseId,
  );
  return merged;
}
