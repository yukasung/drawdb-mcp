// Keeps this drawDB tab in step with the `.ddb` file the MCP server owns.
//
// Snapshots, not deltas. drawDB already holds the whole diagram in six context
// slices, and the server already validates whole documents, so sending the
// document is both simpler and safer than teaching two codebases a shared
// delta grammar.
//
// Echo suppression is by value, not by timing flag: `lastSyncedRef` holds the
// serialization of whatever we last sent or received, and the send effect stays
// quiet while the current state still serializes to it. Applying a remote
// snapshot therefore cannot bounce a commit back out.
import { useCallback, useEffect, useRef, useState } from "react";

import { useAreas, useDiagram, useEnums, useNotes, useTypes } from "../hooks";

const PROTOCOL_VERSION = 1;
/** Long enough to collapse a drag into one commit, short enough to feel live. */
const COMMIT_DEBOUNCE_MS = 200;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

/** This build is only ever served by the bridge, so sync is always on. */
export function isMcpSync() {
  return true;
}

/**
 * Build the `.ddb` document. Key order is fixed so two equal diagrams always
 * produce the same string — the echo check depends on it.
 */
function serialize(state) {
  return JSON.stringify({
    ...state.extra,
    title: state.title,
    database: state.database,
    tables: state.tables,
    relationships: state.relationships,
    notes: state.notes,
    subjectAreas: state.areas,
    enums: state.enums,
    types: state.types,
  });
}

/** Top-level keys drawDB does not model (pan, zoom, gistId, …) survive a round trip. */
function unmodelledKeys(doc) {
  const known = new Set([
    "title",
    "database",
    "tables",
    "relationships",
    "notes",
    "subjectAreas",
    "areas",
    "enums",
    "types",
  ]);
  const extra = {};
  for (const key of Object.keys(doc)) {
    if (!known.has(key)) extra[key] = doc[key];
  }
  return extra;
}

export default function useMcpSync({ title, setTitle }) {
  const { tables, setTables, relationships, setRelationships, database, setDatabase } = useDiagram();
  const { notes, setNotes } = useNotes();
  const { areas, setAreas } = useAreas();
  const { enums, setEnums } = useEnums();
  const { types, setTypes } = useTypes();

  const [status, setStatus] = useState("connecting");
  const socketRef = useRef(null);
  const lastSyncedRef = useRef(null);
  const versionRef = useRef(0);
  const extraRef = useRef({});
  /** Nothing may be committed before the first snapshot, or an empty tab wins the race. */
  const readyRef = useRef(false);

  const applySnapshot = useCallback(
    (message) => {
      const doc = message.diagram ?? {};
      extraRef.current = unmodelledKeys(doc);
      versionRef.current = message.version;

      const next = {
        title: doc.title ?? "Untitled diagram",
        database: doc.database ?? "GENERIC",
        tables: doc.tables ?? [],
        relationships: doc.relationships ?? [],
        notes: doc.notes ?? [],
        areas: doc.subjectAreas ?? doc.areas ?? [],
        enums: doc.enums ?? [],
        types: doc.types ?? [],
        extra: extraRef.current,
      };

      lastSyncedRef.current = serialize(next);
      readyRef.current = true;

      setTitle(next.title);
      setDatabase(next.database);
      setTables(next.tables);
      setRelationships(next.relationships);
      setNotes(next.notes);
      setAreas(next.areas);
      setEnums(next.enums);
      setTypes(next.types);
    },
    [setTitle, setDatabase, setTables, setRelationships, setNotes, setAreas, setEnums, setTypes],
  );

  useEffect(() => {
    let closed = false;
    let retry = RECONNECT_MIN_MS;
    let reconnectTimer;

    const open = () => {
      if (closed) return;
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${scheme}://${window.location.host}/sync`);
      socketRef.current = socket;
      setStatus("connecting");

      socket.onopen = () => {
        retry = RECONNECT_MIN_MS;
        setStatus("live");
      };

      socket.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.v !== PROTOCOL_VERSION) return;
        if (message.type === "snapshot") applySnapshot(message);
        // A refusal is always followed by the authoritative snapshot, so the
        // canvas repairs itself; surface it rather than failing silently.
        if (message.type === "rejected") console.warn("[drawdb-mcp]", message.reason);
      };

      socket.onclose = () => {
        if (closed) return;
        setStatus("offline");
        // The server is usually just restarting; back off rather than spin.
        reconnectTimer = setTimeout(open, retry);
        retry = Math.min(retry * 2, RECONNECT_MAX_MS);
      };

      socket.onerror = () => socket.close();
    };

    open();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [applySnapshot]);

  useEffect(() => {
    if (!readyRef.current) return;

    const timer = setTimeout(() => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const body = serialize({
        title,
        database,
        tables,
        relationships,
        notes,
        areas,
        enums,
        types,
        extra: extraRef.current,
      });
      if (body === lastSyncedRef.current) return;

      lastSyncedRef.current = body;
      socket.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "commit",
          baseVersion: versionRef.current,
          diagram: JSON.parse(body),
        }),
      );
    }, COMMIT_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [title, database, tables, relationships, notes, areas, enums, types]);

  useConnectionBadge(status);

  return status;
}

/**
 * Rendered straight into `document.body` rather than as JSX, so wiring this
 * into upstream's Workspace stays a single inserted line.
 */
function useConnectionBadge(status) {
  useEffect(() => {
    const id = "drawdb-mcp-status";
    let node = document.getElementById(id);

    if (status === "live") {
      node?.remove();
      return;
    }

    if (!node) {
      node = document.createElement("div");
      node.id = id;
      node.style.cssText =
        "position:fixed;bottom:12px;left:12px;z-index:9999;padding:6px 12px;border-radius:6px;" +
        "font:12px system-ui,sans-serif;color:#fff;background:#b45309;box-shadow:0 1px 4px rgba(0,0,0,.3);" +
        "pointer-events:none";
      document.body.appendChild(node);
    }
    node.textContent =
      status === "connecting"
        ? "drawdb-mcp: connecting…"
        : "drawdb-mcp: disconnected — edits are not being saved";
  }, [status]);
}
