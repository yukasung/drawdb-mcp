import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { DB } from "../src/model/constants.js";
import { addNote, addTable } from "../src/model/ops.js";
import { DiagramStore } from "../src/store.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drawdb-mcp-"));
  file = join(dir, "diagram.ddb");
});

describe("DiagramStore", () => {
  it("reads a missing file as an empty generic diagram instead of failing", async () => {
    const store = new DiagramStore(file);
    const d = await store.read();
    expect(d.database).toBe(DB.GENERIC);
    expect(d.tables).toHaveLength(0);
  });

  it("writes areas under subjectAreas, which is the key drawDB imports from", async () => {
    const store = new DiagramStore(file);
    await store.update((d) => {
      d.areas.push({ id: 0, name: "Public", x: 0, y: 0, width: 200, height: 200, color: "#175e7a" });
    });
    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written.subjectAreas).toHaveLength(1);
    expect(written.areas).toBeUndefined();
    // …and reads back into the in-memory name.
    expect((await store.read()).areas).toHaveLength(1);
  });

  it("leaves the file untouched when an op throws", async () => {
    const store = new DiagramStore(file);
    await store.update((d) => addTable(d, { name: "keep" }));
    const before = readFileSync(file, "utf8");

    await expect(store.update(() => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("stays usable after a failed op", async () => {
    const store = new DiagramStore(file);
    await expect(store.update(() => {
      throw new Error("boom");
    })).rejects.toThrow();

    await store.update((d) => addTable(d, { name: "after" }));
    expect((await store.read()).tables.map((t) => t.name)).toEqual(["after"]);
  });

  it("refuses to touch a file that is not valid JSON", async () => {
    writeFileSync(file, "{ not json");
    const store = new DiagramStore(file);
    await expect(store.read()).rejects.toThrow(/not valid JSON/);
  });

  it("refuses to commit an unknown dialect", async () => {
    const store = new DiagramStore(file);
    await expect(
      store.update((d) => {
        (d as Record<string, unknown>).database = "cassandra";
      }),
    ).rejects.toThrow(/Refusing to save/);
  });

  it("serializes concurrent updates instead of losing one", async () => {
    const store = new DiagramStore(file);
    await Promise.all([
      store.update((d) => addTable(d, { name: "a" })),
      store.update((d) => addTable(d, { name: "b" })),
      store.update((d) => addNote(d, { title: "n" })),
    ]);
    const d = await store.read();
    expect(d.tables.map((t) => t.name).sort()).toEqual(["a", "b"]);
    expect(d.notes).toHaveLength(1);
  });

  it("drops relationships pointing at tables that are gone, which drawDB would refuse", async () => {
    writeFileSync(
      file,
      JSON.stringify({
        database: "generic",
        tables: [],
        relationships: [
          {
            id: "r1",
            name: "dangling",
            startTableId: "missing",
            startFieldId: "missing",
            endTableId: "missing",
            endFieldId: "missing",
            cardinality: "one_to_many",
            updateConstraint: "No action",
            deleteConstraint: "No action",
          },
        ],
      }),
    );
    const store = new DiagramStore(file);
    expect((await store.read()).relationships).toHaveLength(0);
  });
});
