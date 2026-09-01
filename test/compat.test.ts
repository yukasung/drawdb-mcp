// The whole file-based design rests on one promise: what this server writes,
// drawdb.app opens. These tests check that against drawDB's OWN import
// validator (vendored, unmodified), rather than against our idea of the format.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Validator } from "jsonschema";
import { describe, expect, it } from "vitest";

import { DB } from "../src/model/constants.js";
import * as ops from "../src/model/ops.js";
import { DiagramStore } from "../src/store.js";
import { ddbSchema, jsonSchema } from "../src/vendor/data/schemas.js";

async function writeRichDiagram(): Promise<Record<string, unknown>> {
  const file = join(mkdtempSync(join(tmpdir(), "drawdb-compat-")), "d.ddb");
  const store = new DiagramStore(file);

  await store.update((d) => {
    ops.setDatabase(d, DB.POSTGRES);
    d.title = "Compat";
    ops.addTable(d, {
      name: "users",
      fields: [
        { name: "id", type: "UUID", primary: true, notNull: true },
        { name: "email", type: "VARCHAR", size: 255, notNull: true, unique: true },
        { name: "role", type: "user_role", notNull: true, default: "viewer" },
      ],
      comment: "people",
    });
    ops.addTable(d, {
      name: "posts",
      fields: [
        { name: "id", type: "UUID", primary: true, notNull: true },
        { name: "author_id", type: "UUID", notNull: true },
        { name: "body", type: "TEXT", check: "length(body) > 0" },
      ],
    });
    ops.addRelationship(d, {
      startTable: "posts",
      startField: "author_id",
      endTable: "users",
      endField: "id",
      deleteConstraint: "Cascade",
    });
    ops.addEnum(d, "user_role", ["admin", "editor", "viewer"]);
    ops.addType(d, "address", [
      { name: "street", type: "TEXT" },
      { name: "zip", type: "VARCHAR" },
    ]);
    ops.addNote(d, { title: "TODO", content: "soft deletes", x: 20, y: 400 });
    ops.addArea(d, { name: "Public", x: 0, y: 0, width: 600, height: 400, color: "#c9f0ff" });
  });

  return JSON.parse(readFileSync(file, "utf8"));
}

describe("drawDB import compatibility", () => {
  it("passes drawDB's .ddb import validator", async () => {
    const result = new Validator().validate(await writeRichDiagram(), ddbSchema);
    expect(result.errors.map(String)).toEqual([]);
  });

  it("passes drawDB's stricter .json import validator", async () => {
    const result = new Validator().validate(await writeRichDiagram(), jsonSchema);
    expect(result.errors.map(String)).toEqual([]);
  });

  it("puts areas where drawDB's import dialog looks for them", async () => {
    const doc = await writeRichDiagram();
    // ImportDiagram does `setAreas(importData.subjectAreas ?? [])` — a file
    // spelling this `areas` opens with every area silently missing.
    expect(doc.subjectAreas).toHaveLength(1);
  });

  it("passes drawDB's referential check on every relationship", async () => {
    const doc = (await writeRichDiagram()) as any;
    for (const rel of doc.relationships) {
      const start = doc.tables.find((t: any) => t.id === rel.startTableId);
      const end = doc.tables.find((t: any) => t.id === rel.endTableId);
      expect(start, `start table of ${rel.name}`).toBeDefined();
      expect(end, `end table of ${rel.name}`).toBeDefined();
      expect(start.fields.some((f: any) => f.id === rel.startFieldId)).toBe(true);
      expect(end.fields.some((f: any) => f.id === rel.endFieldId)).toBe(true);
    }
  });
});
