// Turns anything diagram-shaped into a document `diagramSchema` accepts.
//
// Needed because three very different sources feed the store: a `.ddb` written
// by an older drawDB build, the output of the vendored SQL/DBML importers
// (which emit `{ tables, relationships }` and nothing else), and hand-written
// JSON from `import_diagram`. Each is missing a different set of keys.
import { nanoid } from "nanoid";

import {
  DB,
  defaultAreaHeight,
  defaultAreaWidth,
  defaultBlue,
  defaultNoteHeight,
  defaultNoteTheme,
  noteWidth,
  type DatabaseId,
} from "./constants.js";
import type { Diagram, Field, Table } from "./schemas.js";

export const DEFAULT_TITLE = "Untitled diagram";

export function emptyDiagram(database: DatabaseId = DB.GENERIC): Diagram {
  return {
    title: DEFAULT_TITLE,
    database,
    tables: [],
    relationships: [],
    areas: [],
    notes: [],
    enums: [],
    types: [],
  } as Diagram;
}

function normalizeField(raw: any, index: number): Field {
  return {
    ...raw,
    id: typeof raw?.id === "string" && raw.id ? raw.id : nanoid(),
    name: String(raw?.name ?? `field_${index + 1}`),
    type: String(raw?.type ?? "VARCHAR"),
    primary: Boolean(raw?.primary),
    unique: Boolean(raw?.unique),
    notNull: Boolean(raw?.notNull),
    increment: Boolean(raw?.increment),
    default: String(raw?.default ?? ""),
    check: String(raw?.check ?? ""),
    comment: String(raw?.comment ?? ""),
  } as Field;
}

function normalizeTable(raw: any, index: number): Table {
  return {
    ...raw,
    id: typeof raw?.id === "string" && raw.id ? raw.id : nanoid(),
    name: String(raw?.name ?? `table_${index + 1}`),
    x: Number.isFinite(raw?.x) ? raw.x : 0,
    y: Number.isFinite(raw?.y) ? raw.y : 0,
    fields: Array.isArray(raw?.fields) ? raw.fields.map(normalizeField) : [],
    comment: String(raw?.comment ?? ""),
    indices: Array.isArray(raw?.indices) ? raw.indices : [],
    color: String(raw?.color ?? defaultBlue),
  } as Table;
}

/**
 * Areas and notes carry NUMERIC ids that the GUI uses as array indices, so a
 * normalized document renumbers them 0..n-1 rather than minting nanoids. Any
 * import that arrives with string ids (some older exports do) is renumbered
 * the same way.
 */
function renumber<T extends Record<string, any>>(list: any[], fill: (raw: any, i: number) => T): T[] {
  return list.map((raw, i) => ({ ...fill(raw, i), id: i }));
}

/** A colour drawDB's own import validator will accept: `^#[0-9a-fA-F]{6}$`. */
function hexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function normalizeDiagram(raw: any, fallbackDatabase: DatabaseId = DB.GENERIC): Diagram {
  const database = (raw?.database ?? fallbackDatabase) as DatabaseId;
  // drawDB writes areas under `subjectAreas` on export and reads them from
  // there on import, while calling the same list `areas` in memory. Accept
  // both on the way in; ./serialize.ts puts them back under `subjectAreas` on
  // the way out.
  const rawAreas = Array.isArray(raw?.subjectAreas)
    ? raw.subjectAreas
    : Array.isArray(raw?.areas)
      ? raw.areas
      : [];

  const normalized = {
    ...raw,
    title: typeof raw?.title === "string" && raw.title ? raw.title : DEFAULT_TITLE,
    database,
    tables: Array.isArray(raw?.tables) ? raw.tables.map(normalizeTable) : [],
    relationships: Array.isArray(raw?.relationships)
      ? raw.relationships.map((r: any, i: number) => ({
          ...r,
          id: typeof r?.id === "string" && r.id ? r.id : nanoid(),
          name: String(r?.name ?? `fk_${i + 1}`),
          startTableId: String(r?.startTableId ?? ""),
          startFieldId: String(r?.startFieldId ?? ""),
          endTableId: String(r?.endTableId ?? ""),
          endFieldId: String(r?.endFieldId ?? ""),
          cardinality: r?.cardinality ?? "one_to_many",
          updateConstraint: r?.updateConstraint ?? "No action",
          deleteConstraint: r?.deleteConstraint ?? "No action",
        }))
      : [],
    areas: renumber(rawAreas, (a: any, i: number) => ({
      ...a,
      name: String(a?.name ?? `area_${i + 1}`),
      x: Number.isFinite(a?.x) ? a.x : 0,
      y: Number.isFinite(a?.y) ? a.y : 0,
      width: Number.isFinite(a?.width) ? a.width : defaultAreaWidth,
      height: Number.isFinite(a?.height) ? a.height : defaultAreaHeight,
      color: hexColor(a?.color, defaultBlue),
    })),
    notes: renumber(Array.isArray(raw?.notes) ? raw.notes : [], (n: any, i: number) => ({
      ...n,
      title: String(n?.title ?? `note_${i + 1}`),
      content: String(n?.content ?? ""),
      x: Number.isFinite(n?.x) ? n.x : 0,
      y: Number.isFinite(n?.y) ? n.y : 0,
      // `color` and `height` are REQUIRED by drawDB's note schema — a note
      // without them makes the GUI reject the whole file.
      color: hexColor(n?.color, defaultNoteTheme),
      width: Number.isFinite(n?.width) ? n.width : noteWidth,
      height: Number.isFinite(n?.height) ? n.height : defaultNoteHeight,
    })),
    enums: Array.isArray(raw?.enums)
      ? raw.enums.map((e: any, i: number) => ({
          ...e,
          id: typeof e?.id === "string" && e.id ? e.id : nanoid(),
          name: String(e?.name ?? `enum_${i + 1}`),
          values: Array.isArray(e?.values) ? e.values.map(String) : [],
        }))
      : [],
    types: Array.isArray(raw?.types)
      ? raw.types.map((t: any, i: number) => ({
          ...t,
          id: typeof t?.id === "string" && t.id ? t.id : nanoid(),
          name: String(t?.name ?? `type_${i + 1}`),
          comment: String(t?.comment ?? ""),
          fields: Array.isArray(t?.fields)
            ? t.fields.map((f: any, j: number) => ({
                ...f,
                name: String(f?.name ?? `field_${j + 1}`),
                type: String(f?.type ?? "VARCHAR"),
              }))
            : [],
        }))
      : [],
  } as Diagram;

  delete (normalized as Record<string, unknown>).subjectAreas;
  return pruneDanglingRelationships(normalized);
}

/**
 * drawDB refuses to import a file whose relationship points at a table or
 * field that is not in it — the check is a hard stop in its import dialog, not
 * a warning. Such an edge is unusable anyway, so drop it here rather than let
 * one bad row make the whole diagram unopenable.
 */
function pruneDanglingRelationships(d: Diagram): Diagram {
  const kept = d.relationships.filter((r) => {
    const start = d.tables.find((t) => t.id === r.startTableId);
    const end = d.tables.find((t) => t.id === r.endTableId);
    return (
      start &&
      end &&
      start.fields.some((f) => f.id === r.startFieldId) &&
      end.fields.some((f) => f.id === r.endFieldId)
    );
  });

  if (kept.length !== d.relationships.length) {
    process.stderr.write(
      `drawdb-mcp: dropped ${d.relationships.length - kept.length} relationship(s) pointing at missing tables/fields\n`,
    );
    d.relationships = kept;
  }
  return d;
}
