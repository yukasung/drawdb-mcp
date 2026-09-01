import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { DiagramStore } from "./store.js";
import { registerDiagramTools } from "./tools/diagram.js";
import { registerEnumTypeTools } from "./tools/enums-types.js";
import { registerFieldTools } from "./tools/fields.js";
import { registerIoTools } from "./tools/io.js";
import { registerNoteAreaTools } from "./tools/notes-areas.js";
import { registerRelationshipTools } from "./tools/relationships.js";
import { registerTableTools } from "./tools/tables.js";
import type { ToolContext } from "./tools/helpers.js";

export function createServer(diagramPath: string): { server: McpServer; store: DiagramStore } {
  const server = new McpServer(
    { name: "drawdb-mcp", version: "0.1.0" },
    {
      instructions:
        "Edits a drawDB diagram stored as a .ddb JSON file. The file is the source of truth: every tool " +
        "reads it, applies the change and writes it back atomically, so the user can re-import it into " +
        "drawdb.app (File > Import diagram) at any point. When the server was started with --serve, a " +
        "local drawDB canvas is also open in the browser and mirrors every change live, in both " +
        "directions; the file stays the source of truth either way. " +
        "Tables and fields can be referenced by name or by id. New tables default to (0,0) — call " +
        "auto_arrange after adding several.",
    },
  );

  const store = new DiagramStore(diagramPath);
  const context: ToolContext = { server, store };

  registerDiagramTools(context);
  registerTableTools(context);
  registerFieldTools(context);
  registerRelationshipTools(context);
  registerEnumTypeTools(context);
  registerNoteAreaTools(context);
  registerIoTools(context);

  return { server, store };
}
