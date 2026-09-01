// Pure mutations over a `Diagram`. Every function takes the document, mutates
// it in place and returns whatever the caller needs to report. The store hands
// these a working copy and only commits if nothing threw, so a rejected op
// leaves the file on disk untouched.
//
// Every lookup accepts an id OR a name: the model calling these tools has just
// written "users" and should not have to remember a nanoid to add a column
// to it.
import { nanoid } from "nanoid";

import { dbToTypes } from "../vendor/data/datatypes.js";

import {
  DB,
  defaultAreaHeight,
  defaultAreaWidth,
  defaultBlue,
  defaultNoteHeight,
  defaultNoteTheme,
  noteWidth,
  supportsEnums,
  supportsTypes,
  type DatabaseId,
} from "./constants.js";
import { DrawdbError, notFound } from "./errors.js";
import type {
  Area,
  Diagram,
  DiagramEnum,
  DiagramType,
  Field,
  Note,
  Relationship,
  Table,
} from "./schemas.js";

// ---------------------------------------------------------------- lookups ---

export function resolveTable(d: Diagram, ref: string): Table {
  const byId = d.tables.find((t) => t.id === ref);
  if (byId) return byId;

  const matches = d.tables.filter((t) => t.name.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new DrawdbError(
      `Table name "${ref}" is ambiguous (${matches.length} tables share it). ` +
        `Use one of these ids instead: ${matches.map((t) => t.id).join(", ")}`,
    );
  }
  throw notFound("table", ref, d.tables.map((t) => t.name));
}

export function resolveField(table: Table, ref: string): Field {
  const byId = table.fields.find((f) => f.id === ref);
  if (byId) return byId;

  const byName = table.fields.filter((f) => f.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new DrawdbError(
      `Field name "${ref}" is ambiguous in table "${table.name}". ` +
        `Use one of these ids: ${byName.map((f) => f.id).join(", ")}`,
    );
  }
  throw notFound(
    `field in table "${table.name}"`,
    ref,
    table.fields.map((f) => f.name),
  );
}

/**
 * drawDB's import validator holds colours to `^#[0-9a-fA-F]{6}$`. A CSS name
 * like "red" writes fine here and then makes the GUI refuse the whole file, so
 * it is rejected at the point the caller can still fix it.
 */
function assertHexColor(value: string | undefined, what: string): void {
  if (value !== undefined && !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new DrawdbError(
      `${what} colour "${value}" is not a 6-digit hex colour (e.g. #175e7a). drawDB rejects anything else on import.`,
    );
  }
}

function assertUniqueTableName(d: Diagram, name: string, exceptId?: string): void {
  const clash = d.tables.find(
    (t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) throw new DrawdbError(`A table named "${name}" already exists (id ${clash.id}).`);
}

function assertUniqueFieldName(table: Table, name: string, exceptId?: string): void {
  const clash = table.fields.find(
    (f) => f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) {
    throw new DrawdbError(
      `Table "${table.name}" already has a field named "${name}" (id ${clash.id}).`,
    );
  }
}

// ----------------------------------------------------------------- fields ---

export interface FieldInput {
  name: string;
  type: string;
  size?: number | string;
  primary?: boolean;
  unique?: boolean;
  notNull?: boolean;
  increment?: boolean;
  default?: string;
  check?: string;
  comment?: string;
}

/**
 * Built-in types are stored uppercase, the way the GUI's type picker writes
 * them — `dbToTypes` is keyed that way, and a lowercase `varchar` would miss
 * every lookup that decides whether a type takes a size or a CHECK.
 *
 * A name that is NOT a built-in is left exactly as typed: it is an enum or a
 * custom type, and those are user-defined identifiers whose case is theirs to
 * choose, not ours to fold.
 */
function canonicalType(type: string, database: string): string {
  const upper = type.toUpperCase();
  const known = (dbToTypes as Record<string, Record<string, unknown>>)[database];
  return known && upper in known ? upper : type;
}

function buildField(input: FieldInput, database: string): Field {
  return {
    id: nanoid(),
    name: input.name,
    type: canonicalType(input.type, database),
    ...(input.size !== undefined ? { size: input.size } : {}),
    primary: input.primary ?? false,
    unique: input.unique ?? false,
    notNull: input.notNull ?? false,
    increment: input.increment ?? false,
    default: input.default ?? "",
    check: input.check ?? "",
    comment: input.comment ?? "",
  } as Field;
}

export function addField(d: Diagram, tableRef: string, input: FieldInput): { table: Table; field: Field } {
  const table = resolveTable(d, tableRef);
  assertUniqueFieldName(table, input.name);
  const field = buildField(input, d.database);
  table.fields.push(field);
  return { table, field };
}

export function updateField(
  d: Diagram,
  tableRef: string,
  fieldRef: string,
  updates: Partial<FieldInput>,
): { table: Table; field: Field } {
  const table = resolveTable(d, tableRef);
  const field = resolveField(table, fieldRef);
  if (updates.name !== undefined) assertUniqueFieldName(table, updates.name, field.id);
  if (updates.type !== undefined) {
    updates = { ...updates, type: canonicalType(updates.type, d.database) };
  }
  Object.assign(field, updates);
  return { table, field };
}

/**
 * Deleting a field takes its foreign keys with it. Leaving a relationship
 * pointing at a field id that no longer exists is exactly the state that makes
 * the GUI draw an edge into empty space.
 */
export function deleteField(
  d: Diagram,
  tableRef: string,
  fieldRef: string,
): { table: Table; field: Field; droppedRelationships: number } {
  const table = resolveTable(d, tableRef);
  const field = resolveField(table, fieldRef);

  const before = d.relationships.length;
  d.relationships = d.relationships.filter(
    (r) =>
      !(r.startTableId === table.id && r.startFieldId === field.id) &&
      !(r.endTableId === table.id && r.endFieldId === field.id),
  );
  table.fields = table.fields.filter((f) => f.id !== field.id);

  return { table, field, droppedRelationships: before - d.relationships.length };
}

// ----------------------------------------------------------------- tables ---

export interface TableInput {
  name: string;
  x?: number;
  y?: number;
  fields?: FieldInput[];
  color?: string;
  comment?: string;
}

export function addTable(d: Diagram, input: TableInput): Table {
  assertUniqueTableName(d, input.name);
  assertHexColor(input.color, "Table");

  // No fields given means the caller wants a starting point, not an empty
  // shell — the GUI's "add table" does the same.
  const fields = (
    input.fields?.length
      ? input.fields
      : [{ name: "id", type: "INT", primary: true, notNull: true, increment: true }]
  ).map((f) => buildField(f, d.database));

  const seen = new Set<string>();
  for (const f of fields) {
    const key = f.name.toLowerCase();
    if (seen.has(key)) {
      throw new DrawdbError(`Duplicate field name "${f.name}" in new table "${input.name}".`);
    }
    seen.add(key);
  }

  const table: Table = {
    id: nanoid(),
    name: input.name,
    x: input.x ?? 0,
    y: input.y ?? 0,
    fields,
    comment: input.comment ?? "",
    indices: [],
    color: input.color ?? defaultBlue,
  } as Table;

  d.tables.push(table);
  return table;
}

export function updateTable(d: Diagram, ref: string, updates: Partial<TableInput>): Table {
  const table = resolveTable(d, ref);
  if (updates.name !== undefined) assertUniqueTableName(d, updates.name, table.id);
  assertHexColor(updates.color, "Table");
  const { fields, ...rest } = updates;
  if (fields !== undefined) {
    throw new DrawdbError(
      "update_table does not replace fields. Use add_field / update_field / delete_field instead, " +
        "so field ids (and the relationships pointing at them) survive.",
    );
  }
  Object.assign(table, rest);
  return table;
}

export function deleteTable(d: Diagram, ref: string): { table: Table; droppedRelationships: number } {
  const table = resolveTable(d, ref);
  const before = d.relationships.length;
  d.relationships = d.relationships.filter(
    (r) => r.startTableId !== table.id && r.endTableId !== table.id,
  );
  d.tables = d.tables.filter((t) => t.id !== table.id);
  return { table, droppedRelationships: before - d.relationships.length };
}

// ---------------------------------------------------------- relationships ---

export interface RelationshipInput {
  /** The table holding the foreign key. */
  startTable: string;
  startField: string;
  /** The referenced table. */
  endTable: string;
  endField: string;
  name?: string;
  cardinality?: string;
  updateConstraint?: string;
  deleteConstraint?: string;
}

export function addRelationship(d: Diagram, input: RelationshipInput): Relationship {
  const startTable = resolveTable(d, input.startTable);
  const startField = resolveField(startTable, input.startField);
  const endTable = resolveTable(d, input.endTable);
  const endField = resolveField(endTable, input.endField);

  const duplicate = d.relationships.find(
    (r) =>
      r.startTableId === startTable.id &&
      r.startFieldId === startField.id &&
      r.endTableId === endTable.id &&
      r.endFieldId === endField.id,
  );
  if (duplicate) {
    throw new DrawdbError(
      `That relationship already exists: "${duplicate.name}" (id ${duplicate.id}).`,
    );
  }

  const relationship: Relationship = {
    id: nanoid(),
    name: input.name ?? `fk_${startTable.name}_${startField.name}_${endTable.name}`,
    startTableId: startTable.id,
    startFieldId: startField.id,
    endTableId: endTable.id,
    endFieldId: endField.id,
    cardinality: input.cardinality ?? "one_to_many",
    updateConstraint: input.updateConstraint ?? "No action",
    deleteConstraint: input.deleteConstraint ?? "No action",
  } as Relationship;

  d.relationships.push(relationship);
  return relationship;
}

export function resolveRelationship(d: Diagram, ref: string): Relationship {
  const found = d.relationships.find((r) => r.id === ref || r.name === ref);
  if (!found) throw notFound("relationship", ref, d.relationships.map((r) => r.name));
  return found;
}

export function updateRelationship(
  d: Diagram,
  ref: string,
  updates: Partial<RelationshipInput>,
): Relationship {
  const rel = resolveRelationship(d, ref);
  const { startTable, startField, endTable, endField, ...rest } = updates;

  if (startTable !== undefined || startField !== undefined) {
    const table = resolveTable(d, startTable ?? rel.startTableId);
    const field = resolveField(table, startField ?? rel.startFieldId);
    rel.startTableId = table.id;
    rel.startFieldId = field.id;
  }
  if (endTable !== undefined || endField !== undefined) {
    const table = resolveTable(d, endTable ?? rel.endTableId);
    const field = resolveField(table, endField ?? rel.endFieldId);
    rel.endTableId = table.id;
    rel.endFieldId = field.id;
  }
  Object.assign(rel, rest);
  return rel;
}

export function deleteRelationship(d: Diagram, ref: string): Relationship {
  const rel = resolveRelationship(d, ref);
  d.relationships = d.relationships.filter((r) => r.id !== rel.id);
  return rel;
}

// ---------------------------------------------------------- enums & types ---

function assertEnumsSupported(d: Diagram): void {
  if (!supportsEnums(d.database)) {
    throw new DrawdbError(
      `The "${d.database}" dialect has no first-class enum objects — only "${DB.POSTGRES}" does. ` +
        `Either set_database to postgresql, or model this as a CHECK constraint on the field.`,
    );
  }
}

function assertTypesSupported(d: Diagram): void {
  if (!supportsTypes(d.database)) {
    throw new DrawdbError(
      `The "${d.database}" dialect has no custom type objects — only "${DB.POSTGRES}" and "${DB.GENERIC}" do.`,
    );
  }
}

export function addEnum(d: Diagram, name: string, values: string[]): DiagramEnum {
  assertEnumsSupported(d);
  if (d.enums.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
    throw new DrawdbError(`An enum named "${name}" already exists.`);
  }
  const created = { id: nanoid(), name, values } as DiagramEnum;
  d.enums.push(created);
  return created;
}

export function updateEnum(
  d: Diagram,
  ref: string,
  updates: { name?: string; values?: string[] },
): DiagramEnum {
  const found = d.enums.find((e) => e.id === ref || e.name === ref);
  if (!found) throw notFound("enum", ref, d.enums.map((e) => e.name));
  Object.assign(found, updates);
  return found;
}

export function deleteEnum(d: Diagram, ref: string): DiagramEnum {
  const found = d.enums.find((e) => e.id === ref || e.name === ref);
  if (!found) throw notFound("enum", ref, d.enums.map((e) => e.name));
  d.enums = d.enums.filter((e) => e.id !== found.id);
  return found;
}

export function addType(
  d: Diagram,
  name: string,
  fields: { name: string; type: string }[],
): DiagramType {
  assertTypesSupported(d);
  if (d.types.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    throw new DrawdbError(`A type named "${name}" already exists.`);
  }
  const created = { id: nanoid(), name, fields, comment: "" } as DiagramType;
  d.types.push(created);
  return created;
}

export function updateType(
  d: Diagram,
  ref: string,
  updates: { name?: string; fields?: { name: string; type: string }[] },
): DiagramType {
  const found = d.types.find((t) => t.id === ref || t.name === ref);
  if (!found) throw notFound("type", ref, d.types.map((t) => t.name));
  Object.assign(found, updates);
  return found;
}

export function deleteType(d: Diagram, ref: string): DiagramType {
  const found = d.types.find((t) => t.id === ref || t.name === ref);
  if (!found) throw notFound("type", ref, d.types.map((t) => t.name));
  d.types = d.types.filter((t) => t.id !== found.id);
  return found;
}

// ----------------------------------------------------------- notes & areas --
// Both carry NUMERIC ids that the GUI reads as array indices, so a delete
// renumbers the survivors rather than leaving a hole.

export function addNote(
  d: Diagram,
  input: { title: string; content?: string; x?: number; y?: number; color?: string },
): Note {
  assertHexColor(input.color, "Note");
  const note = {
    id: d.notes.length,
    title: input.title,
    content: input.content ?? "",
    x: input.x ?? 0,
    y: input.y ?? 0,
    color: input.color ?? defaultNoteTheme,
    width: noteWidth,
    height: defaultNoteHeight,
  } as Note;
  d.notes.push(note);
  return note;
}

export function updateNote(d: Diagram, id: number, updates: Partial<Note>): Note {
  assertHexColor(updates.color as string | undefined, "Note");
  const note = d.notes[id];
  if (!note) throw new DrawdbError(`No note with id ${id}. Notes are numbered 0..${d.notes.length - 1}.`);
  Object.assign(note, updates, { id });
  return note;
}

export function deleteNote(d: Diagram, id: number): Note {
  const note = d.notes[id];
  if (!note) throw new DrawdbError(`No note with id ${id}. Notes are numbered 0..${d.notes.length - 1}.`);
  d.notes = d.notes.filter((_, i) => i !== id).map((n, i) => ({ ...n, id: i }));
  return note;
}

export function addArea(
  d: Diagram,
  input: { name: string; x?: number; y?: number; width?: number; height?: number; color?: string },
): Area {
  assertHexColor(input.color, "Area");
  const area = {
    id: d.areas.length,
    name: input.name,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? defaultAreaWidth,
    height: input.height ?? defaultAreaHeight,
    color: input.color ?? defaultBlue,
  } as Area;
  d.areas.push(area);
  return area;
}

export function updateArea(d: Diagram, id: number, updates: Partial<Area>): Area {
  assertHexColor(updates.color as string | undefined, "Area");
  const area = d.areas[id];
  if (!area) throw new DrawdbError(`No area with id ${id}. Areas are numbered 0..${d.areas.length - 1}.`);
  Object.assign(area, updates, { id });
  return area;
}

export function deleteArea(d: Diagram, id: number): Area {
  const area = d.areas[id];
  if (!area) throw new DrawdbError(`No area with id ${id}. Areas are numbered 0..${d.areas.length - 1}.`);
  d.areas = d.areas.filter((_, i) => i !== id).map((a, i) => ({ ...a, id: i }));
  return area;
}

// --------------------------------------------------------------- database ---

/**
 * Switching dialect drops the entities the new one cannot hold. The GUI hides
 * its Enums/Types panels for a dialect without the capability, so entities kept
 * across such a switch become ghosts the user can neither see nor delete.
 */
export function setDatabase(d: Diagram, database: DatabaseId): { droppedEnums: number; droppedTypes: number } {
  d.database = database;
  let droppedEnums = 0;
  let droppedTypes = 0;

  if (!supportsEnums(database) && d.enums.length) {
    droppedEnums = d.enums.length;
    d.enums = [];
  }
  if (!supportsTypes(database) && d.types.length) {
    droppedTypes = d.types.length;
    d.types = [];
  }
  return { droppedEnums, droppedTypes };
}
