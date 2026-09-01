// Vendored from drawdb-io/drawdb (AGPL-3.0). See ../UPSTREAM.md.
// Logic unchanged; the only edits are `.js` extensions on relative imports
// (required by Node ESM) and this header.
// @ts-nocheck
import { parseDbml } from "../dbml/parse.js";
import { reconcileDbml } from "../dbml/reconcile.js";

export function fromDBML(src, database) {
  const parsed = parseDbml(src);
  return reconcileDbml(parsed, null, database);
}
