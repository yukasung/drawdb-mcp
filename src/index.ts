#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { startLiveBridge } from "./live/bridge.js";
import { createServer } from "./server.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function flagValue(argv: string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  return argv[at + 1];
}

function diagramPathFromArgv(argv: string[]): string {
  if (argv.includes("--file")) {
    const value = flagValue(argv, "--file");
    if (!value) {
      process.stderr.write("drawdb-mcp: --file needs a path\n");
      process.exit(1);
    }
    return value;
  }
  return process.env.DRAWDB_FILE ?? "diagram.ddb";
}

/** `--serve` alone picks the default port; `--serve 4000` or DRAWDB_PORT overrides it. */
function servePortFromArgv(argv: string[]): number | undefined {
  const wanted = argv.includes("--serve") || process.env.DRAWDB_SERVE === "1";
  if (!wanted) return undefined;

  const raw = flagValue(argv, "--serve") ?? process.env.DRAWDB_PORT;
  // The value after --serve is optional, so ignore the next flag standing there.
  if (!raw || raw.startsWith("-")) return 4321;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`drawdb-mcp: --serve wants a port, got "${raw}"\n`);
    process.exit(1);
  }
  return port;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { server, store } = createServer(diagramPathFromArgv(argv));

  // stdout is the protocol channel — anything logged there corrupts it.
  process.stderr.write(`drawdb-mcp: editing ${store.filePath}\n`);

  const port = servePortFromArgv(argv);
  if (port !== undefined) {
    const guiDir = process.env.DRAWDB_GUI_DIR ?? join(HERE, "gui");
    // A canvas that will not start is a degraded session, not a dead one: the
    // file-based tools are what the client actually called us for.
    try {
      const bridge = await startLiveBridge(store, { port, guiDir: resolve(guiDir) });
      process.stderr.write(`drawdb-mcp: live canvas on ${bridge.url}\n`);
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, () => void bridge.close().finally(() => process.exit(0)));
      }
    } catch (error) {
      process.stderr.write(
        `drawdb-mcp: live canvas unavailable — ${(error as Error).message}\n` +
          "drawdb-mcp: continuing without it; every tool still edits the file.\n",
      );
    }
  }

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`drawdb-mcp: fatal — ${(error as Error).stack ?? error}\n`);
  process.exit(1);
});
