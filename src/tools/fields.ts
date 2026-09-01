import { z } from "zod";

import { addField, deleteField, updateField } from "../model/ops.js";
import { guard, saved, type ToolContext } from "./helpers.js";

export function registerFieldTools({ server, store }: ToolContext): void {
  server.registerTool(
    "add_field",
    {
      title: "Add field",
      description: "Add a column to an existing table.",
      inputSchema: {
        table: z.string().describe("Table name or id"),
        name: z.string(),
        type: z.string().describe("Column type, e.g. INT, VARCHAR, TEXT. Uppercased on save."),
        size: z
          .union([z.number(), z.string()])
          .optional()
          .describe("Length for sized types like VARCHAR(255)."),
        primary: z.boolean().optional(),
        unique: z.boolean().optional(),
        notNull: z.boolean().optional(),
        increment: z.boolean().optional(),
        default: z.string().optional(),
        check: z.string().optional(),
        comment: z.string().optional(),
      },
    },
    async ({ table, ...field }) =>
      guard(async () => {
        const { result } = await store.update((d) => addField(d, table, field));
        return saved(
          store,
          `Added ${result.table.name}.${result.field.name} (field id ${result.field.id}).`,
        );
      }),
  );

  server.registerTool(
    "update_field",
    {
      title: "Update field",
      description:
        "Change a column. Only the properties you pass are touched; the field keeps its id, so relationships " +
        "pointing at it stay intact.",
      inputSchema: {
        table: z.string().describe("Table name or id"),
        field: z.string().describe("Field name or id"),
        name: z.string().optional(),
        type: z.string().optional(),
        size: z.union([z.number(), z.string()]).optional(),
        primary: z.boolean().optional(),
        unique: z.boolean().optional(),
        notNull: z.boolean().optional(),
        increment: z.boolean().optional(),
        default: z.string().optional(),
        check: z.string().optional(),
        comment: z.string().optional(),
      },
    },
    async ({ table, field, ...updates }) =>
      guard(async () => {
        const { result } = await store.update((d) => updateField(d, table, field, updates));
        return saved(store, `Updated ${result.table.name}.${result.field.name}.`);
      }),
  );

  server.registerTool(
    "delete_field",
    {
      title: "Delete field",
      description: "Delete a column and any relationship that references it.",
      inputSchema: {
        table: z.string().describe("Table name or id"),
        field: z.string().describe("Field name or id"),
      },
    },
    async ({ table, field }) =>
      guard(async () => {
        const { result } = await store.update((d) => deleteField(d, table, field));
        const rels = result.droppedRelationships
          ? ` Also removed ${result.droppedRelationships} relationship(s).`
          : "";
        return saved(store, `Deleted ${result.table.name}.${result.field.name}.${rels}`);
      }),
  );
}
