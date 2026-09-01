// Zod schemas for the drawDB `.ddb` document.
//
// LENIENT ABOUT UNKNOWN KEYS, STRICT ABOUT KNOWN ONES. Every entity is
// `.passthrough()` because the GUI writes fields this server never sets
// (`size`, `unsigned`, `isArray`, `locked`, note `color`/`width`/`height`, …)
// and silently dropping them would corrupt a diagram on round-trip.
//
// The one value that is closed is `database`: it INDEXES the datatype table
// (`vendor/data/datatypes.js`) and the capability table, both of which answer
// an unknown key with a falsy miss rather than throwing. A bogus dialect
// therefore does not crash — it silently degrades everything at once: no
// column types, an empty SQL export, no dialect name in the docs. So it is
// rejected here, at every entry point that can reach the store.
//
// ID MODEL, the easiest thing to get wrong: tables / fields / relationships /
// enums / types carry nanoid STRING ids; areas and notes carry NUMERIC ids
// that the GUI treats as array indices.
import { z } from "zod";

import { CARDINALITIES, CONSTRAINTS, DATABASE_IDS } from "./constants.js";

export const databaseSchema = z.enum(DATABASE_IDS as [string, ...string[]]);
export const cardinalitySchema = z.enum(CARDINALITIES as [string, ...string[]]);
export const referentialConstraintSchema = z.enum(CONSTRAINTS as [string, ...string[]]);

export const fieldSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    primary: z.boolean(),
    unique: z.boolean(),
    notNull: z.boolean(),
    increment: z.boolean(),
    default: z.string(),
    check: z.string(),
    comment: z.string(),
  })
  .passthrough();

export const tableSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    x: z.number(),
    y: z.number(),
    fields: z.array(fieldSchema),
    comment: z.string(),
    indices: z.array(z.unknown()),
    color: z.string(),
  })
  .passthrough();

export const relationshipSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    startTableId: z.string(),
    startFieldId: z.string(),
    endTableId: z.string(),
    endFieldId: z.string(),
    cardinality: cardinalitySchema,
    updateConstraint: referentialConstraintSchema,
    deleteConstraint: referentialConstraintSchema,
  })
  .passthrough();

export const areaSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    color: z.string(),
  })
  .passthrough();

export const noteSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    content: z.string(),
    x: z.number(),
    y: z.number(),
  })
  .passthrough();

export const enumSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    values: z.array(z.string()),
  })
  .passthrough();

/**
 * Type fields are `{ name, type }` pairs, NOT full table fields — the GUI
 * back-fills anything else. Keep only those two required.
 */
export const typeFieldSchema = z
  .object({ name: z.string(), type: z.string() })
  .passthrough();

export const typeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    fields: z.array(typeFieldSchema),
    // Required by drawDB's own import validator, even though it is usually "".
    comment: z.string(),
  })
  .passthrough();

/** The committed document. Validated before every write to disk. */
export const diagramSchema = z
  .object({
    title: z.string(),
    database: databaseSchema,
    tables: z.array(tableSchema),
    relationships: z.array(relationshipSchema),
    areas: z.array(areaSchema),
    notes: z.array(noteSchema),
    enums: z.array(enumSchema),
    types: z.array(typeSchema),
  })
  .passthrough();

/**
 * `import_diagram` input: user-supplied JSON, often exported by an older build.
 * Deliberately near-untyped — requiring the strict entity shapes would reject
 * diagrams the GUI itself opens fine. `normalizeDiagram` in ./normalize.ts
 * fills the gaps, and `diagramSchema` still guards the commit.
 *
 * `database` is the exception, tightened WITH the state schema: an import is
 * the loudest way to set the dialect, and a value the commit would refuse is
 * better refused here, where the error can name the offending key.
 */
export const diagramImportSchema = z
  .object({
    title: z.string().optional(),
    database: databaseSchema.optional(),
    tables: z.array(z.object({}).passthrough()).optional(),
    relationships: z.array(z.object({}).passthrough()).optional(),
    areas: z.array(z.object({}).passthrough()).optional(),
    subjectAreas: z.array(z.object({}).passthrough()).optional(),
    notes: z.array(z.object({}).passthrough()).optional(),
    enums: z.array(z.object({}).passthrough()).optional(),
    types: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough();

export type Field = z.infer<typeof fieldSchema>;
export type Table = z.infer<typeof tableSchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export type Area = z.infer<typeof areaSchema>;
export type Note = z.infer<typeof noteSchema>;
export type DiagramEnum = z.infer<typeof enumSchema>;
export type DiagramType = z.infer<typeof typeSchema>;
export type Diagram = z.infer<typeof diagramSchema>;
export type DiagramImport = z.infer<typeof diagramImportSchema>;
