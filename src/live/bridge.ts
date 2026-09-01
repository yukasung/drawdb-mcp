// Serves the patched drawDB build and keeps every open tab in step with the
// `.ddb` file. The file stays the source of truth: a browser edit is written
// through `store.replace`, the same normalize-and-validate path `import_diagram`
// takes, and only what lands on disk is broadcast back out.
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";

import { WebSocketServer, type WebSocket } from "ws";

import { diagramImportSchema } from "../model/schemas.js";
import { toFileFormat } from "../model/serialize.js";
import type { DiagramStore } from "../store.js";
import { parseClientMessage, rejected, snapshot } from "./protocol.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** Coalesces the burst of fs events a single save produces. */
const WATCH_DEBOUNCE_MS = 80;

export type LiveBridge = {
  port: number;
  url: string;
  close: () => Promise<void>;
};

export type BridgeOptions = {
  port?: number;
  host?: string;
  /** Directory holding the built GUI. A missing one serves an instructions page instead. */
  guiDir?: string;
};

export async function startLiveBridge(store: DiagramStore, options: BridgeOptions = {}): Promise<LiveBridge> {
  const host = options.host ?? "127.0.0.1";
  const guiDir = options.guiDir ? resolve(options.guiDir) : undefined;

  let version = 0;
  /** What the browsers were last told. Comparing against it drops self-inflicted echoes. */
  let lastBroadcast = "";

  const http = createHttpServer((req, res) => serveStatic(req, res, guiDir));
  const wss = new WebSocketServer({ server: http, path: "/sync" });

  const broadcast = async (force = false): Promise<void> => {
    const diagram = await store.read();
    const body = JSON.stringify(toFileFormat(diagram));
    if (!force && body === lastBroadcast) return;
    lastBroadcast = body;
    version += 1;
    const frame = snapshot(version, store.filePath, JSON.parse(body));
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  };

  wss.on("connection", async (socket: WebSocket) => {
    // A joining tab adopts the file, never the other way round — otherwise a
    // stale tab left open overnight would clobber the diagram on reconnect.
    const diagram = await store.read();
    lastBroadcast = JSON.stringify(toFileFormat(diagram));
    socket.send(snapshot(version, store.filePath, JSON.parse(lastBroadcast)));

    socket.on("message", async (data) => {
      const message = parseClientMessage(data.toString());
      if (!message) {
        socket.send(rejected("Unrecognised frame; expected a v1 commit."));
        return;
      }
      // `normalizeDiagram` is deliberately forgiving so the SQL and DBML
      // importers can feed it partial documents. A socket is not a deliberate
      // caller: check the frame first, or one malformed message quietly
      // normalises a whole schema down to an empty diagram.
      const checked = diagramImportSchema.safeParse(message.diagram);
      if (!checked.success) {
        const issue = checked.error.issues[0];
        socket.send(rejected(`Refused a malformed canvas commit — ${issue.path.join(".") || "(root)"}: ${issue.message}`));
        await broadcast(true);
        return;
      }

      try {
        const saved = await store.replace(checked.data);
        // Record before broadcasting so the writer's own edit does not bounce
        // back and reset their cursor mid-drag.
        lastBroadcast = JSON.stringify(toFileFormat(saved));
        version += 1;
        const frame = snapshot(version, store.filePath, JSON.parse(lastBroadcast));
        for (const client of wss.clients) {
          if (client !== socket && client.readyState === client.OPEN) client.send(frame);
        }
      } catch (error) {
        socket.send(rejected((error as Error).message));
        await broadcast(true);
      }
    });
  });

  let watchedDirectory = dirname(store.filePath);
  const unsubscribe = store.onChange(() => {
    // `open_diagram` can point the store at a different directory mid-session.
    if (dirname(store.filePath) !== watchedDirectory) {
      watchedDirectory = dirname(store.filePath);
      watchFile();
    }
    void broadcast();
  });

  // Hand edits: the user exports over the file from drawdb.app, or edits it in
  // an editor. `store.onChange` cannot see those, so watch the filesystem too.
  //
  // Watch the *directory*, not the file. Every write here is a write-to-temp
  // plus a rename, which swaps the inode — a watch on the path itself goes deaf
  // the first time the diagram is saved, and silently stops reporting hand
  // edits from then on.
  let watcher: FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  const watchFile = (): void => {
    watcher?.close();
    watcher = undefined;
    const directory = dirname(store.filePath);
    const name = basename(store.filePath);
    if (!existsSync(directory)) return;
    try {
      watcher = watch(directory, (_event, changed) => {
        // A rename event reports the temp file too; only the diagram matters.
        if (changed && changed !== name) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => void broadcast().catch(() => undefined), WATCH_DEBOUNCE_MS);
      });
    } catch {
      // Watching is a convenience; platforms that refuse it still get tool pushes.
    }
  };
  watchFile();

  // The ws server re-emits the http server's listen errors. Without a handler
  // here that lands as an unhandled 'error' event and takes the whole process
  // down — MCP tools included — over nothing worse than a busy port.
  wss.on("error", () => undefined);

  await new Promise<void>((ready, fail) => {
    const onError = (error: NodeJS.ErrnoException) => {
      http.removeListener("listening", onListening);
      fail(
        error.code === "EADDRINUSE"
          ? new Error(`port ${options.port} is already in use — pass --serve <port> to pick another`)
          : error,
      );
    };
    const onListening = () => {
      http.removeListener("error", onError);
      ready();
    };
    http.once("error", onError);
    http.once("listening", onListening);
    http.listen(options.port ?? 0, host);
  });

  const address = http.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 0);

  return {
    port,
    url: `http://${host}:${port}`,
    close: async () => {
      unsubscribe();
      clearTimeout(debounce);
      watcher?.close();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((done) => wss.close(() => done()));
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}

function serveStatic(req: IncomingMessage, res: ServerResponse, guiDir: string | undefined): void {
  if (!guiDir || !existsSync(guiDir)) {
    res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
    res.end(NO_GUI_PAGE);
    return;
  }

  const requested = decodeURIComponent((req.url ?? "/").split("?")[0]);
  // Resolve inside guiDir and verify, so `..` in the URL cannot escape it.
  const candidate = resolve(join(guiDir, normalize(requested)));
  const inside = candidate === guiDir || candidate.startsWith(guiDir + sep);

  void (async () => {
    if (inside) {
      const info = await stat(candidate).catch(() => undefined);
      if (info?.isFile()) {
        res.writeHead(200, { "content-type": MIME[extname(candidate)] ?? "application/octet-stream" });
        createReadStream(candidate).pipe(res);
        return;
      }
    }
    // Single-page app: an unknown *extensionless* path is a route. A missing
    // asset is a missing asset — answering `/foo/script.js` with index.html
    // just turns a 404 into a parse error in the console. drawDB's build asks
    // for Vercel's analytics script, which does not exist off Vercel.
    const index = join(guiDir, "index.html");
    if (!extname(requested) && existsSync(index)) {
      res.writeHead(200, { "content-type": MIME[".html"] });
      createReadStream(index).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  })();
}

const NO_GUI_PAGE = `<!doctype html><meta charset="utf-8">
<title>drawdb-mcp — GUI not built</title>
<style>body{font:14px/1.6 system-ui;margin:4rem auto;max-width:38rem;padding:0 1rem}code{background:#eee;padding:.15rem .35rem;border-radius:3px}</style>
<h1>The GUI has not been built yet</h1>
<p>The live bridge is running, but there is no drawDB build to serve. Build it once with:</p>
<pre><code>npm run build:gui</code></pre>
<p>That clones drawDB at the pinned commit, applies the sync patch and writes <code>dist/gui</code>.
Then restart the server and reload this page.</p>
`;
