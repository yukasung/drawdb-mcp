import { describe, expect, it } from "vitest";

import { DB } from "../src/model/constants.js";
import { DrawdbError } from "../src/model/errors.js";
import { emptyDiagram } from "../src/model/normalize.js";
import * as ops from "../src/model/ops.js";

function seeded(database = DB.POSTGRES) {
  const d = emptyDiagram(database);
  ops.addTable(d, {
    name: "users",
    fields: [
      { name: "id", type: "INT", primary: true, notNull: true, increment: true },
      { name: "email", type: "varchar", size: 255, notNull: true },
    ],
  });
  ops.addTable(d, {
    name: "posts",
    fields: [
      { name: "id", type: "INT", primary: true },
      { name: "author_id", type: "INT", notNull: true },
    ],
  });
  ops.addRelationship(d, {
    startTable: "posts",
    startField: "author_id",
    endTable: "users",
    endField: "id",
  });
  return d;
}

describe("lookups", () => {
  it("resolves a table by name or id", () => {
    const d = seeded();
    const byName = ops.resolveTable(d, "users");
    expect(ops.resolveTable(d, byName.id)).toBe(byName);
    expect(ops.resolveTable(d, "USERS")).toBe(byName);
  });

  it("names what is available when a lookup misses", () => {
    const d = seeded();
    expect(() => ops.resolveTable(d, "customers")).toThrow(/Available tables: users, posts/);
  });
});

describe("tables", () => {
  it("gives a table with no fields a default id primary key", () => {
    const d = emptyDiagram();
    const t = ops.addTable(d, { name: "solo" });
    expect(t.fields).toHaveLength(1);
    expect(t.fields[0]).toMatchObject({ name: "id", primary: true, increment: true });
  });

  it("rejects a duplicate table name regardless of case", () => {
    const d = seeded();
    expect(() => ops.addTable(d, { name: "USERS" })).toThrow(DrawdbError);
  });

  it("rejects a non-hex colour, which drawDB would refuse on import", () => {
    const d = emptyDiagram();
    expect(() => ops.addTable(d, { name: "t", color: "red" })).toThrow(/6-digit hex/);
  });

  it("deletes the relationships that touched a deleted table", () => {
    const d = seeded();
    const { droppedRelationships } = ops.deleteTable(d, "users");
    expect(droppedRelationships).toBe(1);
    expect(d.relationships).toHaveLength(0);
  });

  it("refuses to replace fields wholesale, which would orphan foreign keys", () => {
    const d = seeded();
    expect(() => ops.updateTable(d, "users", { fields: [] })).toThrow(/add_field/);
  });
});

describe("fields", () => {
  it("uppercases a built-in type but leaves a user-defined one alone", () => {
    const d = emptyDiagram(DB.POSTGRES);
    ops.addTable(d, { name: "t", fields: [{ name: "id", type: "INT" }] });
    const { field: builtin } = ops.addField(d, "t", { name: "a", type: "varchar" });
    const { field: custom } = ops.addField(d, "t", { name: "b", type: "user_role" });
    expect(builtin.type).toBe("VARCHAR");
    expect(custom.type).toBe("user_role");
  });

  it("rejects a duplicate column name", () => {
    const d = seeded();
    expect(() => ops.addField(d, "users", { name: "EMAIL", type: "TEXT" })).toThrow(DrawdbError);
  });

  it("drops the foreign keys that referenced a deleted column", () => {
    const d = seeded();
    const { droppedRelationships } = ops.deleteField(d, "posts", "author_id");
    expect(droppedRelationships).toBe(1);
  });

  it("keeps the field id on update, so relationships survive a rename", () => {
    const d = seeded();
    const before = ops.resolveTable(d, "posts").fields.find((f) => f.name === "author_id")!.id;
    const { field } = ops.updateField(d, "posts", "author_id", { name: "writer_id" });
    expect(field.id).toBe(before);
    expect(d.relationships[0].startFieldId).toBe(before);
  });
});

describe("relationships", () => {
  it("refuses an endpoint that does not exist", () => {
    const d = seeded();
    expect(() =>
      ops.addRelationship(d, {
        startTable: "posts",
        startField: "nope",
        endTable: "users",
        endField: "id",
      }),
    ).toThrow(/not found/);
  });

  it("refuses an exact duplicate", () => {
    const d = seeded();
    expect(() =>
      ops.addRelationship(d, {
        startTable: "posts",
        startField: "author_id",
        endTable: "users",
        endField: "id",
      }),
    ).toThrow(/already exists/);
  });
});

describe("dialect capabilities", () => {
  it("refuses an enum on a dialect that has no first-class enums", () => {
    const d = emptyDiagram(DB.MYSQL);
    expect(() => ops.addEnum(d, "role", ["a"])).toThrow(/postgresql/);
  });

  it("drops entities the new dialect cannot hold when switching", () => {
    const d = emptyDiagram(DB.POSTGRES);
    ops.addEnum(d, "role", ["a", "b"]);
    ops.addType(d, "address", [{ name: "zip", type: "TEXT" }]);
    const result = ops.setDatabase(d, DB.SQLITE);
    expect(result).toEqual({ droppedEnums: 1, droppedTypes: 1 });
    expect(d.enums).toHaveLength(0);
    expect(d.types).toHaveLength(0);
  });
});

describe("notes and areas", () => {
  it("renumbers the survivors after a delete, because ids are array indices", () => {
    const d = emptyDiagram();
    ops.addNote(d, { title: "a" });
    ops.addNote(d, { title: "b" });
    ops.addNote(d, { title: "c" });
    ops.deleteNote(d, 0);
    expect(d.notes.map((n) => [n.id, n.title])).toEqual([
      [0, "b"],
      [1, "c"],
    ]);
  });

  it("reports the legal id range when one is out of bounds", () => {
    const d = emptyDiagram();
    ops.addArea(d, { name: "only" });
    expect(() => ops.deleteArea(d, 5)).toThrow(/numbered 0\.\.0/);
  });
});
