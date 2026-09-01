import { z } from "zod";

import { addArea, addNote, deleteArea, deleteNote, updateArea, updateNote } from "../model/ops.js";
import { guard, saved, type ToolContext } from "./helpers.js";

// Notes and areas are addressed by NUMERIC id, which drawDB treats as the
// entry's array index — so ids shift when one is deleted. That is upstream's
// model, not a simplification here.
const numericId = z.number().int().describe("Numeric id (== array index; ids shift after a delete)");

export function registerNoteAreaTools({ server, store }: ToolContext): void {
  server.registerTool(
    "add_note",
    {
      title: "Add note",
      description: "Pin a sticky note on the canvas.",
      inputSchema: {
        title: z.string(),
        content: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        color: z.string().optional(),
      },
    },
    async (input) =>
      guard(async () => {
        const { result } = await store.update((d) => addNote(d, input));
        return saved(store, `Added note "${result.title}" (id ${result.id}).`);
      }),
  );

  server.registerTool(
    "update_note",
    {
      title: "Update note",
      description: "Edit a sticky note's title, body, position or colour.",
      inputSchema: {
        id: numericId,
        title: z.string().optional(),
        content: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        color: z.string().optional(),
      },
    },
    async ({ id, ...updates }) =>
      guard(async () => {
        const { result } = await store.update((d) => updateNote(d, id, updates as never));
        return saved(store, `Updated note "${result.title}".`);
      }),
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete note",
      description: "Remove a sticky note. Remaining notes are renumbered.",
      inputSchema: { id: numericId },
    },
    async ({ id }) =>
      guard(async () => {
        const { result } = await store.update((d) => deleteNote(d, id));
        return saved(store, `Deleted note "${result.title}". Remaining notes were renumbered.`);
      }),
  );

  server.registerTool(
    "add_area",
    {
      title: "Add subject area",
      description:
        "Draw a labelled rectangle grouping related tables. Purely visual — it does not own the tables inside it.",
      inputSchema: {
        name: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional().describe("Default 200"),
        height: z.number().optional().describe("Default 200"),
        color: z.string().optional(),
      },
    },
    async (input) =>
      guard(async () => {
        const { result } = await store.update((d) => addArea(d, input));
        return saved(store, `Added area "${result.name}" (id ${result.id}).`);
      }),
  );

  server.registerTool(
    "update_area",
    {
      title: "Update subject area",
      description: "Move, resize, rename or recolour a subject area.",
      inputSchema: {
        id: numericId,
        name: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        color: z.string().optional(),
      },
    },
    async ({ id, ...updates }) =>
      guard(async () => {
        const { result } = await store.update((d) => updateArea(d, id, updates as never));
        return saved(store, `Updated area "${result.name}".`);
      }),
  );

  server.registerTool(
    "delete_area",
    {
      title: "Delete subject area",
      description: "Remove a subject area. Remaining areas are renumbered.",
      inputSchema: { id: numericId },
    },
    async ({ id }) =>
      guard(async () => {
        const { result } = await store.update((d) => deleteArea(d, id));
        return saved(store, `Deleted area "${result.name}". Remaining areas were renumbered.`);
      }),
  );
}
