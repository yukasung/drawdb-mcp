// Command-line parsing, kept out of index.ts so it can be tested without
// starting a server.

export const DEFAULT_PORT = 4321;

/**
 * The LAST occurrence wins. `npm run serve` bakes `--serve` into the script, so
 * a user adding `-- --serve 4000` supplies the flag twice; reading the first one
 * would take the script's bare flag and silently ignore the port they asked for.
 */
function flagValue(argv: string[], flag: string): string | undefined {
  const at = argv.lastIndexOf(flag);
  if (at === -1) return undefined;
  return argv[at + 1];
}

export function diagramPathFromArgv(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  if (argv.includes("--file")) {
    const value = flagValue(argv, "--file");
    if (!value || value.startsWith("-")) throw new Error("--file needs a path");
    return value;
  }
  return env.DRAWDB_FILE ?? "diagram.ddb";
}

/** `--serve` alone picks the default port; `--serve 4000` or DRAWDB_PORT overrides it. */
export function servePortFromArgv(argv: string[], env: NodeJS.ProcessEnv = process.env): number | undefined {
  if (!argv.includes("--serve") && env.DRAWDB_SERVE !== "1") return undefined;

  const raw = flagValue(argv, "--serve") ?? env.DRAWDB_PORT;
  // The value after --serve is optional, so ignore the next flag standing there.
  if (!raw || raw.startsWith("-")) return DEFAULT_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--serve wants a port, got "${raw}"`);
  }
  return port;
}
