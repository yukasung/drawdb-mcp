#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { diagramPathFromArgv, servePortFromArgv } from "./cli.js";
import { startLiveBridge } from "./live/bridge.js";
import { createServer } from "./server.js";

const HERE = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  let diagramPath: string;
  let port: number | undefined;
  try {
    diagramPath = diagramPathFromArgv(argv);
    port = servePortFromArgv(argv);
  } catch (error) {
    process.stderr.write(`drawdb-mcp: ${(error as Error).message}\n`);
    process.exit(1);
  }

  const { server, store } = createServer(diagramPath);

  // stdout is the protocol channel — anything logged there corrupts it.
  process.stderr.write(`drawdb-mcp: editing ${store.filePath}\n`);

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
