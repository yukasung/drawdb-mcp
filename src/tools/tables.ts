import { z } from "zod";

import { defaultBlue } from "../model/constants.js";
import { addTable, deleteTable, resolveTable, updateTable } from "../model/ops.js";
import { guard, saved, text, type ToolContext } from "./helpers.js";

const fieldInput = z.object({
  name: z.string(),
  type: z.string().describe("Column type, e.g. INT, VARCHAR, TEXT, TIMESTAMP. Uppercased on save."),
  size: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Length for sized types like VARCHAR(255). Omit to leave the type unsized."),
  primary: z.boolean().optional(),
  unique: z.boolean().optional(),
  notNull: z.boolean().optional(),
  increment: z.boolean().optional().describe("Auto-increment / identity"),
  default: z.string().optional(),
  check: z.string().optional().describe("CHECK constraint expression"),
  comment: z.string().optional(),
});

export function registerTableTools({ server, store }: ToolContext): void {
  server.registerTool(
    "list_tables",
    {
      title: "List tables",
      description: "Table names, ids and column counts. Cheapest way to see what exists.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const d = await store.read();
        if (!d.tables.length) return text("No tables yet.");
        return text(
          d.tables.map((t) => `${t.name} (id ${t.id}) — ${t.fields.length} columns`).join("\n"),
        );
      }),
  );

  server.registerTool(
    "get_table",
    {
      title: "Get one table",
      description: "Full definition of a single table, including field ids needed for relationships.",
      inputSchema: { table: z.string().describe("Table name or id") },
    },
    async ({ table }) =>
      guard(async () => {
        const d = await store.read();
        return text(JSON.stringify(resolveTable(d, table), null, 2));
      }),
  );

  server.registerTool(
    "add_table",
    {
      title: "Add table",
      description:
        "Create a table. Omit `fields` to get a single auto-increment `id` primary key. Coordinates are " +
        "canvas pixels and default to (0,0) — call auto_arrange afterwards to lay a batch of new tables out.",
      inputSchema: {
        name: z.string(),
        fields: z.array(fieldInput).optional(),
        x: z.number().optional().describe("Canvas X, default 0"),
        y: z.number().optional().describe("Canvas Y, default 0"),
        color: z.string().optional().describe(`Header colour, default ${defaultBlue}`),
        comment: z.string().optional(),
      },
    },
    async (input) =>
      guard(async () => {
        const { result } = await store.update((d) => addTable(d, input));
        return saved(
          store,
          `Added table "${result.name}" (id ${result.id}) with ${result.fields.length} column(s).`,
        );
      }),
  );

  server.registerTool(
    "update_table",
    {
      title: "Update table",
      description:
        "Rename or move a table, or change its colour/comment. Columns are NOT edited here — use " +
        "add_field / update_field / delete_field so field ids and their foreign keys survive.",
      inputSchema: {
        table: z.string().describe("Table name or id"),
        name: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        color: z.string().optional(),
        comment: z.string().optional(),
      },
    },
    async ({ table, ...updates }) =>
      guard(async () => {
        const { result } = await store.update((d) => updateTable(d, table, updates));
        return saved(store, `Updated table "${result.name}".`);
      }),
  );

  server.registerTool(
    "delete_table",
    {
      title: "Delete table",
      description:
        "Delete a table and every relationship touching it — an edge pointing at a removed table is what " +
        "makes the GUI draw a line into empty space.",
      inputSchema: { table: z.string().describe("Table name or id") },
    },
    async ({ table }) =>
      guard(async () => {
        const { result } = await store.update((d) => deleteTable(d, table));
        const rels = result.droppedRelationships
          ? ` Also removed ${result.droppedRelationships} relationship(s).`
          : "";
        return saved(store, `Deleted table "${result.table.name}".${rels}`);
      }),
  );
}
