// The on-disk `.ddb` shape, which is NOT quite the in-memory shape.
//
// drawDB keeps subject areas in a state slice called `areas` but writes and
// reads them as `subjectAreas` — its import dialog does
// `setAreas(importData.subjectAreas ?? [])`, so a file that spells the key
// `areas` opens with every area silently gone. Upstream bridges this in
// `utils/exportSavedData.js`; this is the same bridge, in one place.
import type { Diagram } from "./schemas.js";

export function toFileFormat(d: Diagram): Record<string, unknown> {
  const { areas, ...rest } = d as Diagram & { areas: unknown[] };
  return {
    ...rest,
    subjectAreas: areas,
  };
}
