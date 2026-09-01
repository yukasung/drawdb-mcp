// The `.ddb` file IS the state. There is no in-memory authority that can drift
// from disk: every mutation reads the file, applies the op to a copy,
// validates, and writes atomically. That is what lets the user keep the file
// open in drawDB, re-import it, and edit it by hand between tool calls.
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DB, type DatabaseId } from "./model/constants.js";
import { DrawdbError } from "./model/errors.js";
import { emptyDiagram, normalizeDiagram } from "./model/normalize.js";
import { toFileFormat } from "./model/serialize.js";
import { diagramSchema, type Diagram } from "./model/schemas.js";

export type ChangeListener = (diagram: Diagram) => void;

export class DiagramStore {
  private path: string;
  /** Serializes writes so two tool calls in flight cannot interleave read-modify-write. */
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * Fired after a committed write. The live bridge uses this to push the new
   * document to connected browsers; nothing in the file-only path depends on
   * it, so a server started without --serve behaves exactly as before.
   */
  private listeners = new Set<ChangeListener>();

  constructor(path: string) {
    this.path = resolve(path);
  }

  get filePath(): string {
    return this.path;
  }

  async setPath(path: string): Promise<void> {
    this.path = resolve(path);
    this.notify(await this.read());
  }

  /** Subscribe to committed writes. Returns the unsubscribe function. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * A listener must never be able to fail a tool call that already committed to
   * disk, so their errors are swallowed rather than propagated to the caller.
   */
  private notify(diagram: Diagram): void {
    for (const listener of this.listeners) {
      try {
        listener(diagram);
      } catch {
        // A broken subscriber is not the writer's problem.
      }
    }
  }

  async read(): Promise<Diagram> {
    if (!existsSync(this.path)) return emptyDiagram(DB.GENERIC);

    const text = await readFile(this.path, "utf8");
    if (!text.trim()) return emptyDiagram(DB.GENERIC);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new DrawdbError(
        `${this.path} is not valid JSON (${(error as Error).message}). ` +
          `Refusing to touch it — fix or move the file, or point the server at another one with open_diagram.`,
      );
    }
    return normalizeDiagram(parsed);
  }

  /**
   * Apply `mutate` to a working copy and commit only if it returns without
   * throwing AND the result validates. A rejected op leaves the file exactly
   * as it was.
   */
  async update<T>(mutate: (diagram: Diagram) => T | Promise<T>): Promise<{ result: T; diagram: Diagram }> {
    const run = async () => {
      const draft = structuredClone(await this.read());
      const result = await mutate(draft);
      const diagram = this.validate(draft);
      await this.write(diagram);
      this.notify(diagram);
      return { result, diagram };
    };

    const next = this.queue.then(run, run);
    // Keep the chain alive after a rejection, or every later call inherits it.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private validate(diagram: Diagram): Diagram {
    const parsed = diagramSchema.safeParse(diagram);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new DrawdbError(`Refusing to save an invalid diagram — ${issues}`);
    }
    return parsed.data as Diagram;
  }

  /** Write to a sibling temp file then rename, so a crash mid-write cannot truncate the diagram. */
  private async write(diagram: Diagram): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(toFileFormat(diagram), null, 2)}\n`, "utf8");
    await rename(tmp, this.path);
  }

  /** Replace the whole document (import_diagram, import_sql, new_diagram). */
  async replace(raw: unknown, fallbackDatabase: DatabaseId = DB.GENERIC): Promise<Diagram> {
    const { diagram } = await this.update((draft) => {
      const next = normalizeDiagram(raw, fallbackDatabase);
      Object.assign(draft, next);
      // Object.assign leaves keys the incoming document does not have; the
      // normalized one is complete, so drop anything it did not carry.
      for (const key of Object.keys(draft)) {
        if (!(key in next)) delete (draft as Record<string, unknown>)[key];
      }
    });
    return diagram;
  }
}
