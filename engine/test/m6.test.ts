import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { parseBoard } from "../src/board/parse.js";
import { Executor } from "../src/run/executor.js";
import { Store } from "../src/storage/db.js";
import type { BoardFile, Tile } from "../src/board/types.js";

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-m6-"));
  return new Store(path.join(dir, "test.db"));
}

function boardWith(tiles: Tile[]): BoardFile {
  return { format: "patchbay.board", version: 1, name: "m6", tiles, wires: [] };
}

function verifyTile(id: string, checks: { type: string; onFail?: "block" | "warn"; [key: string]: unknown }[]): Tile {
  return { id, kind: "verify", name: id, checks };
}

function actionTile(id: string): Tile {
  return {
    id, kind: "action", name: id, risk: "read",
    source: { type: "http", method: "GET", url: "https://example.com" },
  };
}

function stepsOf(store: Store, runId: string) {
  return (store as any).db.prepare("SELECT tile_id, decision, outcome FROM steps WHERE run_id=? ORDER BY step").all(runId);
}

describe("M6 verify tiles (§4.7)", () => {
  describe("check types", () => {
    it("regex check passes when pattern matches input", async () => {
      const store = makeStore();
      const runner = async (t: Tile) => ({ ran: t.id });
      const ex = new Executor(store, runner);
      const board = boardWith([
        actionTile("t1"),
        verifyTile("v1", [{ type: "regex", pattern: "ran", onFail: "block" }]),
      ]);
      board.wires = [{ id: "w1", kind: "data", from: "t1", to: "v1" }];
      const boardId = store.saveBoard("m6-regex", board.tiles as unknown[], board.wires as unknown[]);
      const result = await ex.run(board, boardId);
      expect(result.status).toBe("completed");
      const steps = stepsOf(store, result.runId);
      const vStep = steps.find((s: any) => s.tile_id === "v1");
      expect(vStep.outcome).toBe("ok");
    });

    it("regex check with onFail=block stops the run", async () => {
      const store = makeStore();
      const runner = async (t: Tile) => ({ ran: t.id });
      const ex = new Executor(store, runner);
      const board = boardWith([
        actionTile("t1"),
        verifyTile("v1", [{ type: "regex", pattern: "nomatch", onFail: "block" }]),
        actionTile("t2"),
      ]);
      board.wires = [
        { id: "w1", kind: "data", from: "t1", to: "v1" },
        { id: "w2", kind: "data", from: "v1", to: "t2" },
      ];
      const boardId = store.saveBoard("m6-regex-block", board.tiles as unknown[], board.wires as unknown[]);
      const result = await ex.run(board, boardId);
      expect(result.status).toBe("failed");
      const steps = stepsOf(store, result.runId);
      const vStep = steps.find((s: any) => s.tile_id === "v1");
      expect(vStep.outcome).toBe("blocked");
      // t2 should never run because v1 blocked
      const t2Step = steps.find((s: any) => s.tile_id === "t2");
      expect(t2Step).toBeUndefined();
    });

    it("json_path check passes when path exists in args", async () => {
      const store = makeStore();
      const runner = async (t: Tile) => ({ status: "ok", body: { version: "1.0" } });
      const ex = new Executor(store, runner);
      const board = boardWith([
        actionTile("t1"),
        verifyTile("v1", [{ type: "json_path", path: "body.version", onFail: "block" }]),
      ]);
      board.wires = [{ id: "w1", kind: "data", from: "t1", to: "v1" }];
      const boardId = store.saveBoard("m6-jsonpath", board.tiles as unknown[], board.wires as unknown[]);
      const result = await ex.run(board, boardId);
      expect(result.status).toBe("completed");
      const steps = stepsOf(store, result.runId);
      const vStep = steps.find((s: any) => s.tile_id === "v1");
      expect(vStep.outcome).toBe("ok");
    });

    it("file_exists check passes for an existing file", async () => {
      const store = makeStore();
      const runner = async () => ({ ok: true });
      const ex = new Executor(store, runner);
      const tmpFile = path.join(os.tmpdir(), `pb-m6-file-${crypto.randomBytes(8).toString("hex")}`);
      fs.writeFileSync(tmpFile, "hello");
      try {
        const board = boardWith([
          verifyTile("v1", [{ type: "file_exists", path: tmpFile, onFail: "block" }]),
        ]);
        const boardId = store.saveBoard("m6-file-exists", board.tiles as unknown[], board.wires as unknown[]);
        const result = await ex.run(board, boardId);
        expect(result.status).toBe("completed");
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it("command_zero_exit check passes for a zero-exit command", async () => {
      const store = makeStore();
      const runner = async () => ({ ok: true });
      const ex = new Executor(store, runner);
      const board = boardWith([
        verifyTile("v1", [{ type: "command_zero_exit", command: "true", onFail: "block" }]),
      ]);
      const boardId = store.saveBoard("m6-command-zero", board.tiles as unknown[], board.wires as unknown[]);
      const result = await ex.run(board, boardId);
      expect(result.status).toBe("completed");
    });

    it("onFail=warn continues even when check fails", async () => {
      const store = makeStore();
      const runner = async (t: Tile) => ({ ran: t.id });
      const ex = new Executor(store, runner);
      const board = boardWith([
        actionTile("t1"),
        verifyTile("v1", [{ type: "regex", pattern: "nomatch", onFail: "warn" }]),
        actionTile("t2"),
      ]);
      board.wires = [
        { id: "w1", kind: "data", from: "t1", to: "v1" },
        { id: "w2", kind: "data", from: "v1", to: "t2" },
      ];
      const boardId = store.saveBoard("m6-warn", board.tiles as unknown[], board.wires as unknown[]);
      const result = await ex.run(board, boardId);
      expect(result.status).toBe("completed");
      const steps = stepsOf(store, result.runId);
      expect(steps.find((s: any) => s.tile_id === "t2")).toBeDefined();
    });
  });
});

describe("M6 run replay data (§5.7)", () => {
  it("steps and audit are readable for a completed run (replay source data)", async () => {
    const store = makeStore();
    let calls = 0;
    const runner = async () => { calls += 1; return { ran: true }; };
    const ex = new Executor(store, runner);
    const board = boardWith([actionTile("t1")]);
    const boardId = store.saveBoard("m6-replay-data", board.tiles as unknown[], board.wires as unknown[]);
    const result = await ex.run(board, boardId);
    expect(result.status).toBe("completed");

    const callsBefore = calls;
    // Read back steps + audit — this is what /runs/:id/replay serves.
    // It must be read-only: no new action calls.
    const steps = (store as any).db.prepare(
      "SELECT step,tile_id,decision,risk,outcome FROM steps WHERE run_id=? ORDER BY step"
    ).all(result.runId);
    const audit = store.auditForRun(result.runId);
    expect(calls).toBe(callsBefore);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].tile_id).toBe("t1");
    expect(steps[0].outcome).toBe("ok");
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].tile_id).toBe("t1");
  });
});
