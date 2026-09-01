import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { DrawdbError } from "../model/errors.js";
import type { Diagram } from "../model/schemas.js";
import type { DiagramStore } from "../store.js";

export type ToolContext = { server: McpServer; store: DiagramStore };

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

/**
 * Tool errors come back as `isError` content rather than thrown exceptions, so
 * the model reads the message and corrects itself instead of seeing a protocol
 * failure. Unexpected errors keep their stack out of the response but say
 * enough to act on.
 */
export async function guard(fn: () => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    const message =
      error instanceof DrawdbError ? error.message : `Unexpected error: ${(error as Error).message}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

/** One line per table — what a caller almost always wants instead of the whole document. */
export function outline(d: Diagram): string {
  if (!d.tables.length) return `(empty diagram, dialect ${d.database})`;

  const tables = d.tables
    .map((t) => {
      const cols = t.fields
        .map((f) => {
          const flags = [
            f.primary ? "PK" : null,
            f.notNull ? "NOT NULL" : null,
            f.unique ? "UNIQUE" : null,
            f.increment ? "AUTO" : null,
          ].filter(Boolean);
          const size = (f as Record<string, unknown>).size;
          const type = size ? `${f.type}(${size})` : f.type;
          return `    - ${f.name}: ${type}${flags.length ? ` [${flags.join(", ")}]` : ""}`;
        })
        .join("\n");
      return `  ${t.name} (id ${t.id})\n${cols}`;
    })
    .join("\n");

  const rels = d.relationships.length
    ? d.relationships
        .map((r) => {
          const from = d.tables.find((t) => t.id === r.startTableId);
          const to = d.tables.find((t) => t.id === r.endTableId);
          const fromField = from?.fields.find((f) => f.id === r.startFieldId);
          const toField = to?.fields.find((f) => f.id === r.endFieldId);
          return `  ${r.name}: ${from?.name}.${fromField?.name} -> ${to?.name}.${toField?.name} (${r.cardinality})`;
        })
        .join("\n")
    : "  (none)";

  const extras = [
    d.enums.length ? `enums: ${d.enums.map((e) => e.name).join(", ")}` : null,
    d.types.length ? `types: ${d.types.map((t) => t.name).join(", ")}` : null,
    d.notes.length ? `notes: ${d.notes.length}` : null,
    d.areas.length ? `areas: ${d.areas.length}` : null,
  ].filter(Boolean);

  return [
    `dialect: ${d.database}`,
    `tables (${d.tables.length}):`,
    tables,
    `relationships (${d.relationships.length}):`,
    rels,
    ...extras,
  ].join("\n");
}

export function saved(store: DiagramStore, message: string): ToolResult {
  return text(`${message}\nSaved to ${store.filePath}`);
}
