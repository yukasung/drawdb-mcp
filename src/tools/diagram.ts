import { z } from "zod";

import { DATABASE_IDS, type DatabaseId } from "../model/constants.js";
import { emptyDiagram } from "../model/normalize.js";
import { setDatabase } from "../model/ops.js";
import { guard, outline, saved, text, type ToolContext } from "./helpers.js";

const databaseArg = z
  .enum(DATABASE_IDS as [string, ...string[]])
  .describe(`Target SQL dialect. One of: ${DATABASE_IDS.join(", ")}`);

export function registerDiagramTools({ server, store }: ToolContext): void {
  server.registerTool(
    "get_diagram",
    {
      title: "Get diagram",
      description:
        "Read the current diagram. Returns a compact outline by default (tables, columns, flags, relationships); " +
        "pass format=json for the raw .ddb document, which is large.",
      inputSchema: {
        format: z
          .enum(["outline", "json"])
          .optional()
          .describe("outline (default) is far cheaper to read; json is the full document."),
      },
    },
    async ({ format }) =>
      guard(async () => {
        const diagram = await store.read();
        if (format === "json") return text(JSON.stringify(diagram, null, 2));
        return text(`${outline(diagram)}\n\nFile: ${store.filePath}`);
      }),
  );

  server.registerTool(
    "set_database",
    {
      title: "Set database dialect",
      description:
        "Change the diagram's SQL dialect. Enums exist only on postgresql and custom types only on " +
        "postgresql/generic, so switching to a dialect without them DROPS those entities — the GUI hides " +
        "the panels that would let a user delete them otherwise.",
      inputSchema: { database: databaseArg },
    },
    async ({ database }) =>
      guard(async () => {
        const { result } = await store.update((d) => setDatabase(d, database as DatabaseId));
        const dropped = [
          result.droppedEnums ? `${result.droppedEnums} enum(s)` : null,
          result.droppedTypes ? `${result.droppedTypes} custom type(s)` : null,
        ].filter(Boolean);
        return saved(
          store,
          `Dialect set to ${database}.${dropped.length ? ` Dropped ${dropped.join(" and ")} the dialect cannot hold.` : ""}`,
        );
      }),
  );

  server.registerTool(
    "new_diagram",
    {
      title: "New diagram",
      description:
        "Discard the current diagram and start an empty one. Overwrites the file the server is pointed at.",
      inputSchema: {
        database: databaseArg.optional(),
        title: z.string().optional().describe("Diagram name shown in drawDB and in exported docs"),
      },
    },
    async ({ database, title }) =>
      guard(async () => {
        const fresh = emptyDiagram((database ?? "generic") as DatabaseId);
        if (title) fresh.title = title;
        await store.replace(fresh);
        return saved(store, `New empty diagram "${fresh.title}" (${database ?? "generic"}).`);
      }),
  );

  server.registerTool(
    "set_title",
    {
      title: "Rename the diagram",
      description:
        "Set the diagram's name. drawDB shows it in the editor header, and export_docs uses it as the " +
        "document heading.",
      inputSchema: { title: z.string() },
    },
    async ({ title }) =>
      guard(async () => {
        await store.update((d) => {
          d.title = title;
        });
        return saved(store, `Diagram renamed to "${title}".`);
      }),
  );

  server.registerTool(
    "open_diagram",
    {
      title: "Open a different .ddb file",
      description:
        "Point the server at another .ddb file for the rest of the session. The file is created on first write " +
        "if it does not exist.",
      inputSchema: { path: z.string().describe("Absolute or relative path to a .ddb file") },
    },
    async ({ path }) =>
      guard(async () => {
        await store.setPath(path);
        const diagram = await store.read();
        return text(`Now editing ${store.filePath}\n\n${outline(diagram)}`);
      }),
  );

  server.registerTool(
    "save_diagram_as",
    {
      title: "Save a copy",
      description:
        "Write the current diagram to another path AND continue editing there. Use it to snapshot before a " +
        "risky change, or to hand a file to someone.",
      inputSchema: { path: z.string().describe("Destination .ddb path") },
    },
    async ({ path }) =>
      guard(async () => {
        const diagram = await store.read();
        await store.setPath(path);
        await store.replace(diagram);
        return saved(store, `Copied the diagram to ${store.filePath}; further edits go there.`);
      }),
  );
}
