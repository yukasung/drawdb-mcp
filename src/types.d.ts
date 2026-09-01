// `oracle-sql-parser` ships no types. It is used only through the one call in
// tools/io.ts, transcribed from upstream's import path.
declare module "oracle-sql-parser" {
  export class Parser {
    parse(sql: string): unknown;
  }
}
