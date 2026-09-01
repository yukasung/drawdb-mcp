// The single message shape both ends speak. Snapshots, not deltas: the `.ddb`
// document is the unit the store already validates, so sending anything
// smaller would mean maintaining a second, weaker model of a change.
import type { Diagram } from "../model/schemas.js";

export const PROTOCOL_VERSION = 1;

/** Server -> browser: this is the diagram now. Sent on connect and on every commit. */
export type SnapshotMessage = {
  v: typeof PROTOCOL_VERSION;
  type: "snapshot";
  /** Monotonic per-process. The browser echoes it back so we can spot a stale commit. */
  version: number;
  path: string;
  diagram: Record<string, unknown>;
};

/** Browser -> server: the user edited the canvas; write this to the file. */
export type CommitMessage = {
  v: typeof PROTOCOL_VERSION;
  type: "commit";
  /** The snapshot version this edit was made against. */
  baseVersion: number;
  diagram: Record<string, unknown>;
};

/** Server -> browser: the commit was refused; `snapshot` that follows is the truth. */
export type RejectedMessage = {
  v: typeof PROTOCOL_VERSION;
  type: "rejected";
  reason: string;
};

export type ServerMessage = SnapshotMessage | RejectedMessage;
export type ClientMessage = CommitMessage;

export function snapshot(version: number, path: string, diagram: Diagram | Record<string, unknown>): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    type: "snapshot",
    version,
    path,
    diagram,
  } satisfies SnapshotMessage);
}

export function rejected(reason: string): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, type: "rejected", reason } satisfies RejectedMessage);
}

/** Parse a frame from the browser. Returns null for anything we do not recognise. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const message = parsed as Record<string, unknown>;
  if (message.v !== PROTOCOL_VERSION || message.type !== "commit") return null;
  if (typeof message.diagram !== "object" || message.diagram === null) return null;
  return {
    v: PROTOCOL_VERSION,
    type: "commit",
    baseVersion: typeof message.baseVersion === "number" ? message.baseVersion : 0,
    diagram: message.diagram as Record<string, unknown>,
  };
}
