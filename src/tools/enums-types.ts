import { z } from "zod";

import { addEnum, addType, deleteEnum, deleteType, updateEnum, updateType } from "../model/ops.js";
import { guard, saved, type ToolContext } from "./helpers.js";

const typeField = z.object({ name: z.string(), type: z.string() });

export function registerEnumTypeTools({ server, store }: ToolContext): void {
  server.registerTool(
    "add_enum",
    {
      title: "Add enum",
      description:
        "Create a first-class enum type. PostgreSQL only — drawDB models enums as CREATE TYPE objects, not " +
        "as MySQL's inline ENUM column type. On other dialects, use a CHECK constraint on the field instead.",
      inputSchema: { name: z.string(), values: z.array(z.string()).describe("Enum members, in order") },
    },
    async ({ name, values }) =>
      guard(async () => {
        const { result } = await store.update((d) => addEnum(d, name, values));
        return saved(store, `Added enum "${result.name}" with ${result.values.length} value(s).`);
      }),
  );

  server.registerTool(
    "update_enum",
    {
      title: "Update enum",
      description: "Rename an enum or replace its value list.",
      inputSchema: {
        enum: z.string().describe("Enum name or id"),
        name: z.string().optional(),
        values: z.array(z.string()).optional().describe("Replaces the whole list"),
      },
    },
    async ({ enum: ref, ...updates }) =>
      guard(async () => {
        const { result } = await store.update((d) => updateEnum(d, ref, updates));
        return saved(store, `Updated enum "${result.name}".`);
      }),
  );

  server.registerTool(
    "delete_enum",
    {
      title: "Delete enum",
      description: "Remove an enum. Columns still typed with it keep the type string as-is.",
      inputSchema: { enum: z.string().describe("Enum name or id") },
    },
    async ({ enum: ref }) =>
      guard(async () => {
        const { result } = await store.update((d) => deleteEnum(d, ref));
        return saved(store, `Deleted enum "${result.name}".`);
      }),
  );

  server.registerTool(
    "add_type",
    {
      title: "Add custom type",
      description:
        "Create a composite type. PostgreSQL and generic diagrams only. Type fields are name/type pairs.",
      inputSchema: { name: z.string(), fields: z.array(typeField) },
    },
    async ({ name, fields }) =>
      guard(async () => {
        const { result } = await store.update((d) => addType(d, name, fields));
        return saved(store, `Added type "${result.name}" with ${result.fields.length} field(s).`);
      }),
  );

  server.registerTool(
    "update_type",
    {
      title: "Update custom type",
      description: "Rename a composite type or replace its field list.",
      inputSchema: {
        type: z.string().describe("Type name or id"),
        name: z.string().optional(),
        fields: z.array(typeField).optional().describe("Replaces the whole list"),
      },
    },
    async ({ type, ...updates }) =>
      guard(async () => {
        const { result } = await store.update((d) => updateType(d, type, updates));
        return saved(store, `Updated type "${result.name}".`);
      }),
  );

  server.registerTool(
    "delete_type",
    {
      title: "Delete custom type",
      description: "Remove a composite type.",
      inputSchema: { type: z.string().describe("Type name or id") },
    },
    async ({ type }) =>
      guard(async () => {
        const { result } = await store.update((d) => deleteType(d, type));
        return saved(store, `Deleted type "${result.name}".`);
      }),
  );
}
