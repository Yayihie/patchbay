import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph, topoOrder, GraphError } from "../src/graph/graph.js";
import { Executor, type Tile } from "../src/run/executor.js";
import { Store } from "../src/storage/db.js";
import type { BoardFile } from "../src/board/types.js";

const tiles = (specs: [string, string, string?][], extra: Record<string, unknown> = {}): Tile[] =>
  specs.map(([id, kind, name]) => ({ id, kind, name: name ?? id, ...extra }));

const board = (t: Tile[], wires: unknown[]): BoardFile =>
  ({ format: "patchbay.board", version: 1, name: "m1", tiles: t, wires: wires as BoardFile["wires"] }) as BoardFile;

describe("graph", () => {
  it("topoOrders data wires", () => {
    const b = board(
      tiles([["a", "context"], ["b", "action"], ["c", "action"]]),
      [
        { id: "w1", kind: "data", from: "a", to: "b" },
        { id: "w2", kind: "data", from: "b", to: "c" },
      ],
    );
    expect(topoOrder(b)).toEqual(["a", "b", "c"]);
  });
  it("refuses a data-wire cycle", () => {
    const b = board(
      tiles([["a", "action"], ["b", "action"]]),
      [
        { id: "w1", kind: "data", from: "a", to: "b" },
        { id: "w2", kind: "data", from: "b", to: "a" },
      ],
    );
    expect(() => topoOrder(b)).toThrow(GraphError);
  });
  it("hasGrant requires the exact triple", () => {
    const g = buildGraph(board(tiles([["v", "vault"], ["ag", "agent"]]), [
      { id: "p1", kind: "permission", from: "v", to: "ag", grant: "use-credentials" },
    ]));
    expect(g.hasGrant("ag", "v", "use-credentials")).toBe(true);
    expect(g.hasGrant("ag", "v", "invoke-action")).toBe(false);
  });
});

describe("executor + store", () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-m1-")); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("runs actions in wire order, passing mapped data", async () => {
    const store = new Store(path.join(tmp, "t.db"));
    const b = board(
      tiles([["src", "context"], ["act", "action"], ["sink", "action"]]).map((t) => t.kind === "action" ? { ...t, source: { type: "http", method: "GET", url: "http://example.test" }, risk: "read" } : t),
      [
        { id: "d1", kind: "data", from: "src", to: "act" },
        { id: "d2", kind: "data", from: "act", to: "sink" },
      ],
    );
    const boardId = store.saveBoard("m1", b.tiles, b.wires);
    const called: string[] = [];
    const ex = new Executor(store, async (tile) => {
      called.push(tile.id);
      return { from: tile.id };
    });
    const res = await ex.run(b, boardId, { inputs: { src: { payload: "hi" } } });
    expect(res.status).toBe("completed");
    expect(called).toEqual(["act", "sink"]);
    expect((res.outputs["sink"] as { from: string }).from).toBe("sink");
    store.close();
  });

  it("records a failed run in the store, not silently", async () => {
    const store = new Store(path.join(tmp, "t.db"));
    const b = board(tiles([["act", "action"]]).map((t) => ({ ...t, source: { type: "http", method: "GET", url: "http://example.test" }, risk: "read" })), []);
    const boardId = store.saveBoard("m1", b.tiles, b.wires);
    const ex = new Executor(store, async () => { throw new Error("boom"); });
    const res = await ex.run(b, boardId);
    expect(res.status).toBe("failed");
    expect(store.runStatus(res.runId).status).toBe("failed");
    store.close();
  });
});
