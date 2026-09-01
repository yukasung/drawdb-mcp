// Vendored from drawdb-io/drawdb (AGPL-3.0). See ../UPSTREAM.md.
// Logic unchanged; the only edits are `.js` extensions on relative imports
// (required by Node ESM) and this header.
// @ts-nocheck
import { DB } from "../../data/constants.js";

export function findReferencedTable(tables, currentTable, name) {
  return currentTable.name === name
    ? currentTable
    : tables.find((table) => table.name === name);
}

function quoteColumn(str, db) {
  switch (db) {
    case DB.MYSQL:
      return `\`${str}\``;
    case DB.SQLITE:
      return `"${str}"`;
    case DB.POSTGRES:
      return `"${str}"`;
    case DB.MSSQL:
      return `[${str}]`;
    case DB.MARIADB:
      return `\`${str}\``;
  }
}

export function buildSQLFromAST(ast, db = DB.MYSQL) {
  if (ast.type === "binary_expr") {
    const leftSQL = buildSQLFromAST(ast.left, db);
    const rightSQL = buildSQLFromAST(ast.right, db);
    return `${leftSQL} ${ast.operator} ${rightSQL}`;
  }

  if (ast.type === "function") {
    let expr = "";
    expr = ast.name;
    if (ast.args) {
      expr +=
        "(" +
        ast.args.value
          .map((v) => {
            if (v.type === "column_ref") return "`" + v.column + "`";
            if (
              v.type === "single_quote_string" ||
              v.type === "double_quote_string"
            )
              return "'" + v.value + "'";
            return v.value;
          })
          .join(", ") +
        ")";
    }
    return expr;
  } else if (ast.type === "column_ref") {
    return quoteColumn(ast.column, db);
  } else if (ast.type === "expr_list") {
    return ast.value.map((v) => v.value).join(" AND ");
  } else {
    return typeof ast.value === "string" ? "'" + ast.value + "'" : ast.value;
  }
}
