// Drives the server over the real MCP protocol, so tool schemas, handlers and
// the store are exercised the way a client exercises them.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";

let client: Client;
let file: string;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result: any = await client.callTool({ name, arguments: args });
  return { text: result.content.map((c: any) => c.text).join("\n"), isError: !!result.isError };
}

async function expectOk(name: string, args: Record<string, unknown> = {}) {
  const r = await call(name, args);
  expect(r.isError, `${name}: ${r.text}`).toBe(false);
  return r.text;
}

beforeEach(async () => {
  file = join(mkdtempSync(join(tmpdir(), "drawdb-tools-")), "d.ddb");
  const { server } = createServer(file);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
});

describe("tool surface", () => {
  it("exposes every entity and I/O tool", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const expected of [
      "get_diagram", "set_database", "set_title", "new_diagram", "open_diagram", "save_diagram_as",
      "list_tables", "get_table", "add_table", "update_table", "delete_table",
      "add_field", "update_field", "delete_field",
      "add_relationship", "update_relationship", "delete_relationship",
      "add_enum", "update_enum", "delete_enum", "add_type", "update_type", "delete_type",
      "add_note", "update_note", "delete_note", "add_area", "update_area", "delete_area",
      "export_sql", "export_dbml", "export_docs", "export_mermaid", "export_diagram",
      "import_sql", "import_dbml", "import_diagram", "auto_arrange",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("reports a missing table as a readable error, not a protocol failure", async () => {
    const r = await call("add_field", { table: "ghost", name: "x", type: "INT" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/not found/);
  });
});

describe("building a schema", () => {
  it("creates tables, columns and a foreign key addressed by name", async () => {
    await expectOk("set_database", { database: "postgresql" });
    await expectOk("add_table", {
      name: "users",
      fields: [{ name: "id", type: "INT", primary: true, increment: true, notNull: true }],
    });
    await expectOk("add_table", { name: "posts" });
    await expectOk("add_field", { table: "posts", name: "author_id", type: "INT", notNull: true });
    await expectOk("add_relationship", {
      startTable: "posts",
      startField: "author_id",
      endTable: "users",
      endField: "id",
    });

    const outline = await expectOk("get_diagram");
    expect(outline).toMatch(/posts\.author_id -> users\.id/);
  });
});

describe("codecs", () => {
  const SQL = `
    CREATE TABLE customers (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL UNIQUE
    );
    CREATE TABLE orders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      customer_id INT NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
  `;

  it("imports SQL, then exports DDL that still has both tables and the FK", async () => {
    await expectOk("set_database", { database: "mysql" });
    await expectOk("import_sql", { sql: SQL, dialect: "mysql" });

    const ddl = await expectOk("export_sql");
    expect(ddl).toMatch(/CREATE TABLE.*customers/s);
    expect(ddl).toMatch(/CREATE TABLE.*orders/s);
    expect(ddl).toMatch(/REFERENCES/);
  });

  it("reports a SQL syntax error with its location instead of throwing", async () => {
    const r = await call("import_sql", { sql: "CREATE TABLE (((", dialect: "mysql" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/SQL syntax error/);
  });

  it("round-trips through DBML", async () => {
    await expectOk("import_dbml", {
      dbml: `
        Table products {
          id integer [pk, increment]
          sku varchar(64) [not null, unique]
        }
        Table reviews {
          id integer [pk]
          product_id integer [not null]
        }
        Ref: reviews.product_id > products.id
      `,
    });

    const dbml = await expectOk("export_dbml");
    expect(dbml).toMatch(/Table products/);
    expect(dbml).toMatch(/Table reviews/);
    expect(dbml).toMatch(/Ref /);
  });

  it("merges an import into the existing diagram when asked", async () => {
    await expectOk("add_table", { name: "existing" });
    await expectOk("import_dbml", { dbml: "Table added {\n id integer [pk]\n}", mode: "merge" });

    const tables = await expectOk("list_tables");
    expect(tables).toMatch(/existing/);
    expect(tables).toMatch(/added/);
  });

  it("round-trips the .ddb document byte for byte", async () => {
    await expectOk("add_table", { name: "t", fields: [{ name: "id", type: "INT", primary: true }] });
    await expectOk("add_note", { title: "n" });
    await expectOk("add_area", { name: "a" });

    const before = readFileSync(file, "utf8");
    await expectOk("import_diagram", { json: before });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses to export a generic diagram without a target dialect", async () => {
    await expectOk("add_table", { name: "t" });
    const r = await call("export_sql");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/not a SQL dialect/);
  });

  it("renders documentation with the diagram's title and a mermaid block", async () => {
    await expectOk("set_title", { title: "Shop" });
    await expectOk("add_table", { name: "t", fields: [{ name: "id", type: "INT", primary: true }] });

    const docs = await expectOk("export_docs");
    expect(docs).toMatch(/# Shop documentation/);
    expect(docs).toMatch(/```mermaid/);
  });
});
