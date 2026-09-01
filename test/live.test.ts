import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { startLiveBridge, type LiveBridge } from "../src/live/bridge.js";
import { DiagramStore } from "../src/store.js";

let bridge: LiveBridge | undefined;

afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

async function scratchStore(): Promise<DiagramStore> {
  const dir = await mkdtemp(join(tmpdir(), "drawdb-live-"));
  return new DiagramStore(join(dir, "diagram.ddb"));
}

/** Resolves with the next frame of `type`, so a test never races the connect snapshot. */
function nextFrame(socket: WebSocket, type: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${type}"`)), 4000);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(`${url.replace("http", "ws")}/sync`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

describe("live bridge", () => {
  it("sends a snapshot as soon as a tab connects", async () => {
    const store = await scratchStore();
    await store.replace({ title: "Hello", database: "postgresql", tables: [] });
    bridge = await startLiveBridge(store);

    const socket = await connect(bridge.url);
    const frame = await nextFrame(socket, "snapshot");

    expect(frame.diagram.title).toBe("Hello");
    expect(frame.path).toBe(store.filePath);
    socket.close();
  });

  it("pushes a snapshot when a tool writes the file", async () => {
    const store = await scratchStore();
    await store.replace({ title: "Before", database: "postgresql", tables: [] });
    bridge = await startLiveBridge(store);

    const socket = await connect(bridge.url);
    await nextFrame(socket, "snapshot");

    const pushed = nextFrame(socket, "snapshot");
    await store.update((draft) => {
      draft.title = "After";
    });

    expect((await pushed).diagram.title).toBe("After");
    socket.close();
  });

  it("writes a browser commit through to the file", async () => {
    const store = await scratchStore();
    await store.replace({ title: "Untitled", database: "postgresql", tables: [] });
    bridge = await startLiveBridge(store);

    const socket = await connect(bridge.url);
    const first = await nextFrame(socket, "snapshot");

    socket.send(
      JSON.stringify({
        v: 1,
        type: "commit",
        baseVersion: first.version,
        diagram: { ...first.diagram, title: "Renamed in the canvas" },
      }),
    );

    await expect
      .poll(async () => JSON.parse(await readFile(store.filePath, "utf8")).title, { timeout: 4000 })
      .toBe("Renamed in the canvas");
    socket.close();
  });

  it("relays one tab's commit to the others but not back to the sender", async () => {
    const store = await scratchStore();
    await store.replace({ title: "Shared", database: "postgresql", tables: [] });
    bridge = await startLiveBridge(store);

    const author = await connect(bridge.url);
    const observer = await connect(bridge.url);
    const first = await nextFrame(author, "snapshot");
    await nextFrame(observer, "snapshot");

    const echoed = nextFrame(observer, "snapshot");
    let bouncedBack = false;
    author.on("message", (raw) => {
      if (JSON.parse(raw.toString()).type === "snapshot") bouncedBack = true;
    });

    author.send(
      JSON.stringify({
        v: 1,
        type: "commit",
        baseVersion: first.version,
        diagram: { ...first.diagram, title: "Edited by author" },
      }),
    );

    expect((await echoed).diagram.title).toBe("Edited by author");
    expect(bouncedBack).toBe(false);
    author.close();
    observer.close();
  });

  it("rejects a commit that would not validate, and leaves the file alone", async () => {
    const store = await scratchStore();
    await store.replace({ title: "Good", database: "postgresql", tables: [] });
    bridge = await startLiveBridge(store);

    const socket = await connect(bridge.url);
    await nextFrame(socket, "snapshot");

    const refusal = nextFrame(socket, "rejected");
    socket.send(JSON.stringify({ v: 1, type: "commit", baseVersion: 1, diagram: { tables: "not a list" } }));

    expect((await refusal).reason).toBeTruthy();
    expect(JSON.parse(await readFile(store.filePath, "utf8")).title).toBe("Good");
    socket.close();
  });

  it("pushes edits made to the file by hand", async () => {
    const store = await scratchStore();
    await store.replace({ title: "On disk", database: "postgresql", tables: [] });
    bridge = await startLiveBridge(store);

    const socket = await connect(bridge.url);
    await nextFrame(socket, "snapshot");

    const pushed = nextFrame(socket, "snapshot");
    const onDisk = JSON.parse(await readFile(store.filePath, "utf8"));
    await writeFile(store.filePath, JSON.stringify({ ...onDisk, title: "Edited by hand" }, null, 2));

    expect((await pushed).diagram.title).toBe("Edited by hand");
    socket.close();
  });

  it("still sees hand edits after a tool write has replaced the file", async () => {
    const store = await scratchStore();
    await store.replace({ title: "First", database: "postgresql", tables: [] });
    bridge = await startLiveBridge(store);

    const socket = await connect(bridge.url);
    await nextFrame(socket, "snapshot");

    // Every commit swaps the inode via tmp-write plus rename. A watch on the
    // path itself goes deaf right here, and hand edits stop arriving.
    const afterTool = nextFrame(socket, "snapshot");
    await store.update((draft) => {
      draft.title = "Written by a tool";
    });
    await afterTool;

    const afterHand = nextFrame(socket, "snapshot");
    const onDisk = JSON.parse(await readFile(store.filePath, "utf8"));
    await writeFile(store.filePath, JSON.stringify({ ...onDisk, title: "Edited by hand" }, null, 2));

    expect((await afterHand).diagram.title).toBe("Edited by hand");
    socket.close();
  });

  it("404s a missing asset instead of answering it with the app shell", async () => {
    const gui = await mkdtemp(join(tmpdir(), "drawdb-gui-"));
    await writeFile(join(gui, "index.html"), "<!doctype html><title>app</title>");
    bridge = await startLiveBridge(await scratchStore(), { guiDir: gui });

    // drawDB's build requests this; off Vercel it does not exist. Served as
    // HTML it becomes "SyntaxError: Unexpected token '<'" in every console.
    const asset = await fetch(`${bridge.url}/_vercel/insights/script.js`);
    expect(asset.status).toBe(404);

    // Routes still resolve to the app shell.
    const route = await fetch(`${bridge.url}/editor/diagrams/abc`);
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("<title>app</title>");
  });

  it("serves an instructions page when the GUI has not been built", async () => {
    bridge = await startLiveBridge(await scratchStore(), { guiDir: "/nope/not/built" });

    const response = await fetch(bridge.url);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("npm run build:gui");
  });
});

describe("live bridge startup", () => {
  it("reports a busy port instead of crashing the process", async () => {
    const store = await scratchStore();
    bridge = await startLiveBridge(store);

    await expect(startLiveBridge(await scratchStore(), { port: bridge.port })).rejects.toThrow(
      /already in use/,
    );
  });
});
