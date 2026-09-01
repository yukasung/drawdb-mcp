#!/usr/bin/env node
// Builds the browser canvas that `--serve` hosts.
//
// drawDB's React app is NOT vendored into this repo. It is cloned at the same
// commit `src/vendor/.upstream-sha` pins, an overlay of our own files is copied
// in, and exactly two lines are inserted into one upstream file. Keeping the
// divergence that small is what makes a re-sync a bump of the SHA rather than a
// merge.
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = join(ROOT, ".gui-build");
const CLONE = join(WORK, "drawdb");
const OUT = join(ROOT, "dist", "gui");
const OVERLAY = join(ROOT, "gui", "overlay");
const REPO = "https://github.com/drawdb-io/drawdb.git";

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

/**
 * Insert `addition` after the line containing `anchor`. Throws if the anchor is
 * missing or ambiguous — a patch that silently no-ops would ship a GUI that
 * builds fine and never syncs.
 */
function insertAfter(source, anchor, addition, what) {
  const hits = source.split("\n").filter((line) => line.includes(anchor)).length;
  if (hits === 0) throw new Error(`Patch anchor for ${what} is gone from upstream: ${anchor}`);
  if (hits > 1) throw new Error(`Patch anchor for ${what} is ambiguous (${hits} matches): ${anchor}`);
  return source.replace(anchor, `${anchor}\n${addition}`);
}

async function main() {
  const sha = (await readFile(join(ROOT, "src", "vendor", ".upstream-sha"), "utf8")).trim();

  console.log(`drawdb-mcp: building GUI from drawdb-io/drawdb @ ${sha.slice(0, 8)}`);
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });

  run("git", ["init", "-q", "drawdb"], WORK);
  run("git", ["remote", "add", "origin", REPO], CLONE);
  run("git", ["fetch", "-q", "--depth", "1", "origin", sha], CLONE);
  run("git", ["checkout", "-q", "FETCH_HEAD"], CLONE);

  await cp(OVERLAY, join(CLONE), { recursive: true });

  const workspacePath = join(CLONE, "src", "components", "Workspace.jsx");
  let workspace = await readFile(workspacePath, "utf8");

  workspace = insertAfter(
    workspace,
    'import { useTranslation } from "react-i18next";',
    'import useMcpSync, { isMcpSync } from "../mcp/useMcpSync";',
    "the sync import",
  );
  workspace = insertAfter(
    workspace,
    "  const loadedIdRef = useRef(null);",
    "  useMcpSync({ title, setTitle });",
    "the sync hook call",
  );
  // The server's file is the source of truth; letting the editor restore its
  // own IndexedDB copy on mount would race the first snapshot and sometimes win.
  workspace = insertAfter(
    workspace,
    "  const load = useCallback(async () => {",
    "    if (isMcpSync()) return;",
    "the local-load guard",
  );

  await writeFile(workspacePath, workspace, "utf8");

  run("npm", ["install", "--no-audit", "--no-fund"], CLONE);
  run("npm", ["run", "build"], CLONE);

  const built = join(CLONE, "dist");
  if (!existsSync(built)) throw new Error(`drawDB build produced no dist/ at ${built}`);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(dirname(OUT), { recursive: true });
  await cp(built, OUT, { recursive: true });
  await rm(WORK, { recursive: true, force: true });

  console.log(`drawdb-mcp: GUI ready at ${OUT}`);
}

main().catch((error) => {
  console.error(`drawdb-mcp: GUI build failed — ${error.message}`);
  process.exit(1);
});
