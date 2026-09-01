import { z } from "zod";

import { CARDINALITIES, CONSTRAINTS } from "../model/constants.js";
import { addRelationship, deleteRelationship, updateRelationship } from "../model/ops.js";
import { guard, saved, type ToolContext } from "./helpers.js";

const cardinality = z
  .enum(CARDINALITIES as [string, ...string[]])
  .describe(`Read start -> end. One of: ${CARDINALITIES.join(", ")}. Default one_to_many.`);

const constraint = z
  .enum(CONSTRAINTS as [string, ...string[]])
  .describe(`Referential action. One of: ${CONSTRAINTS.join(", ")}. Default "No action".`);

export function registerRelationshipTools({ server, store }: ToolContext): void {
  server.registerTool(
    "add_relationship",
    {
      title: "Add relationship",
      description:
        "Draw a foreign key. `startTable`/`startField` is the side HOLDING the foreign key; " +
        "`endTable`/`endField` is the referenced column (usually a primary key). Tables and fields may be " +
        "given by name or id.",
      inputSchema: {
        startTable: z.string().describe("Table holding the FK column, by name or id"),
        startField: z.string().describe("The FK column, by name or id"),
        endTable: z.string().describe("Referenced table, by name or id"),
        endField: z.string().describe("Referenced column, by name or id"),
        name: z.string().optional().describe("Constraint name; defaults to fk_<start>_<field>_<end>"),
        cardinality: cardinality.optional(),
        updateConstraint: constraint.optional(),
        deleteConstraint: constraint.optional(),
      },
    },
    async (input) =>
      guard(async () => {
        const { result } = await store.update((d) => addRelationship(d, input));
        return saved(store, `Added relationship "${result.name}" (id ${result.id}).`);
      }),
  );

  server.registerTool(
    "update_relationship",
    {
      title: "Update relationship",
      description: "Change a foreign key's endpoints, cardinality, name or referential actions.",
      inputSchema: {
        relationship: z.string().describe("Relationship name or id"),
        startTable: z.string().optional(),
        startField: z.string().optional(),
        endTable: z.string().optional(),
        endField: z.string().optional(),
        name: z.string().optional(),
        cardinality: cardinality.optional(),
        updateConstraint: constraint.optional(),
        deleteConstraint: constraint.optional(),
      },
    },
    async ({ relationship, ...updates }) =>
      guard(async () => {
        const { result } = await store.update((d) => updateRelationship(d, relationship, updates));
        return saved(store, `Updated relationship "${result.name}".`);
      }),
  );

  server.registerTool(
    "delete_relationship",
    {
      title: "Delete relationship",
      description: "Remove a foreign key. The columns themselves are left alone.",
      inputSchema: { relationship: z.string().describe("Relationship name or id") },
    },
    async ({ relationship }) =>
      guard(async () => {
        const { result } = await store.update((d) => deleteRelationship(d, relationship));
        return saved(store, `Deleted relationship "${result.name}".`);
      }),
  );
}
