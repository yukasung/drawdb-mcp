// Domain constants. The values come from the vendored upstream table so the
// two cannot drift — this file only adds TypeScript types and the capability
// matrix the tools gate on.
import {
  Cardinality as VendorCardinality,
  Constraint as VendorConstraint,
  DB as VendorDB,
  defaultBlue as vendorDefaultBlue,
  defaultNoteTheme as vendorDefaultNoteTheme,
  noteWidth as vendorNoteWidth,
  tableColorStripHeight as vendorColorStrip,
  tableFieldHeight as vendorFieldHeight,
  tableHeaderHeight as vendorHeaderHeight,
  tableWidth as vendorTableWidth,
} from "../vendor/data/constants.js";

export const DB = VendorDB as {
  MYSQL: "mysql";
  POSTGRES: "postgresql";
  MSSQL: "transactsql";
  SQLITE: "sqlite";
  MARIADB: "mariadb";
  ORACLESQL: "oraclesql";
  GENERIC: "generic";
};

export type DatabaseId = (typeof DB)[keyof typeof DB];

/** Every legal `database` value, in `DB` declaration order. */
export const DATABASE_IDS = Object.values(DB) as DatabaseId[];

export const Cardinality = VendorCardinality as {
  ONE_TO_ONE: "one_to_one";
  ONE_TO_MANY: "one_to_many";
  MANY_TO_ONE: "many_to_one";
};
export const CARDINALITIES = Object.values(Cardinality) as Cardinality[];
export type Cardinality = (typeof Cardinality)[keyof typeof Cardinality];

export const Constraint = VendorConstraint as {
  NONE: "No action";
  RESTRICT: "Restrict";
  CASCADE: "Cascade";
  SET_NULL: "Set null";
  SET_DEFAULT: "Set default";
};
export const CONSTRAINTS = Object.values(Constraint) as ReferentialConstraint[];
export type ReferentialConstraint = (typeof Constraint)[keyof typeof Constraint];

export const defaultBlue: string = vendorDefaultBlue;
export const defaultNoteTheme: string = vendorDefaultNoteTheme;
export const noteWidth: number = vendorNoteWidth;
/** AreasContextProvider / NotesContextProvider literals — not exported upstream. */
export const defaultNoteHeight = 88;
export const defaultAreaWidth = 200;
export const defaultAreaHeight = 200;

export const tableWidth: number = vendorTableWidth;
export const tableHeaderHeight: number = vendorHeaderHeight;
export const tableFieldHeight: number = vendorFieldHeight;
export const tableColorStripHeight: number = vendorColorStrip;

export interface DatabaseCapabilities {
  /** First-class enum objects (the `enums` collection). PostgreSQL only. */
  hasEnums: boolean;
  /** Composite/custom type objects (the `types` collection). */
  hasTypes: boolean;
  hasArrays: boolean;
  /** The `UNSIGNED` numeric modifier. */
  hasUnsignedTypes: boolean;
}

/**
 * Transcribed verbatim from upstream `src/data/databases.js`, including the
 * two entries that look like oversights but are not "fixed" here: `generic`
 * declares types but not enums, and mysql/mariadb have neither even though
 * both have an ENUM column type — drawDB models enums as first-class
 * PostgreSQL objects, never as inline column types. Allowing what the GUI
 * hides would produce entities the user can neither see nor delete.
 */
export const dbCapabilities: Record<DatabaseId, DatabaseCapabilities> = {
  [DB.MYSQL]: { hasEnums: false, hasTypes: false, hasArrays: false, hasUnsignedTypes: true },
  [DB.POSTGRES]: { hasEnums: true, hasTypes: true, hasArrays: true, hasUnsignedTypes: false },
  [DB.MSSQL]: { hasEnums: false, hasTypes: false, hasArrays: false, hasUnsignedTypes: false },
  [DB.SQLITE]: { hasEnums: false, hasTypes: false, hasArrays: false, hasUnsignedTypes: false },
  [DB.MARIADB]: { hasEnums: false, hasTypes: false, hasArrays: false, hasUnsignedTypes: true },
  [DB.ORACLESQL]: { hasEnums: false, hasTypes: false, hasArrays: false, hasUnsignedTypes: false },
  [DB.GENERIC]: { hasEnums: false, hasTypes: true, hasArrays: false, hasUnsignedTypes: false },
};

const NO_CAPABILITIES: DatabaseCapabilities = {
  hasEnums: false,
  hasTypes: false,
  hasArrays: false,
  hasUnsignedTypes: false,
};

/** An unknown id answers "no" to everything, rather than throwing. */
export function capabilitiesOf(database: string | undefined): DatabaseCapabilities {
  return dbCapabilities[database as DatabaseId] ?? NO_CAPABILITIES;
}

export function supportsEnums(database: string | undefined): boolean {
  return capabilitiesOf(database).hasEnums;
}

export function supportsTypes(database: string | undefined): boolean {
  return capabilitiesOf(database).hasTypes;
}
