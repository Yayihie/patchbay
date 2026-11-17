import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Executor } from "../src/run/executor.js";
import { Store } from "../src/storage/db.js";
import type { BoardFile, Tile } from "../src/board/types.js";

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-m7-"));
  return new Store(path.join(dir, "test.db"));
}

function boardWith(tiles: Tile[]): BoardFile {
  return { format: "patchbay.board", version: 1, name: "m7", tiles, wires: [] };
}

function actionTile(id: string, risk: "read" | "write" | "irreversible" = "read"): Tile {
  return {
    id, kind: "action", name: id, risk,
    source: { type: "http", method: "GET", url: "https://example.com" },
  };
}

describe("M7 fault tolerance (§19)", () => {
  describe("retry with exponential backoff", () => {
    it("retries a transient failure up to 3 attempts then completes", async () => {
      const store = makeStore();
      let calls = 0;
      const runner = async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient failure");
        return { value: "ok" };
      };
      const boardId = store.saveBoard("m7-retry", [actionTile("t1")] as unknown[], []);
      const ex = new Executor(store, runner);

      const result = await ex.run(boardWith([actionTile("t1")]), boardId);

      expect(result.status).toBe("completed");
      expect(calls).toBe(3);
      const traces = store.getTraces(result.runId);
      expect(traces.length).toBe(3);
      const last = traces[traces.length - 1];
      const detail = JSON.parse(last.detail_json ?? "{}");
      expect(detail.ok).toBe(true);
    });

    it("fails after exhausting all 3 retries", async () => {
      const store = makeStore();
      const runner = async () => { throw new Error("permanent failure"); };
      const boardId = store.saveBoard("m7-retry-fail", [actionTile("t1")] as unknown[], []);
      const ex = new Executor(store, runner);

      const result = await ex.run(boardWith([actionTile("t1")]), boardId);

      expect(result.status).toBe("failed");
      const traces = store.getTraces(result.runId);
      expect(traces.length).toBe(3); // exactly maxRetries attempts
    });
  });

  describe("retryRun recovers a failed run", () => {
    it("skips completed steps and re-runs only the failed step", async () => {
      const store = makeStore();
      let t2Calls = 0;
      const runner = async (tile: Tile) => {
        if (tile.id === "t2") {
          t2Calls += 1;
          if (t2Calls <= 3) throw new Error("transient failure on t2"); // exhausts run() retries
        }
        return { ran: tile.id };
      };

      const boardId = store.saveBoard("m7-retryrun", [actionTile("t1"), actionTile("t2")] as unknown[], []);
      const ex = new Executor(store, runner);

      // First run: t1 completes, t2 fails on its first attempt (then exhausts retries)
      const result = await ex.run(boardWith([actionTile("t1"), actionTile("t2")]), boardId);
      expect(result.status).toBe("failed");

      // t1's output is persisted; t2 never completed
      const completed = (store as any).db.prepare("SELECT tile_id FROM steps WHERE run_id=? AND output_json IS NOT NULL").all(result.runId);
      expect(completed.map((r: any) => r.tile_id)).toContain("t1");
      expect(completed.map((r: any) => r.tile_id)).not.toContain("t2");

      // Retry: t2 now succeeds on its first attempt; t1 must NOT be re-run
      const recovered = await ex.retryRun(boardWith([actionTile("t1"), actionTile("t2")]), boardId, result.runId);
      expect(recovered.status).toBe("completed");
      expect(t2Calls).toBe(4); // 3 failed attempts in run() + 1 success in retryRun()

      // t1 should not appear in post-retry new steps (it was skipped)
      const steps = (store as any).db.prepare("SELECT tile_id, step FROM steps WHERE run_id=? ORDER BY step").all(result.runId);
      const t1Steps = steps.filter((r: any) => r.tile_id === "t1");
      expect(t1Steps.length).toBe(1); // t1 executed exactly once total
    });

    it("returns failed when no steps were ever completed", async () => {
      const store = makeStore();
      const runner = async () => { throw new Error("always fails"); };
      const boardId = store.saveBoard("m7-nothing", [actionTile("t1")] as unknown[], []);
      const ex = new Executor(store, runner);

      const result = await ex.run(boardWith([actionTile("t1")]), boardId);
      expect(result.status).toBe("failed");

      const recovered = await ex.retryRun(boardWith([actionTile("t1")]), boardId, result.runId);
      expect(recovered.status).toBe("failed");
      expect(recovered.steps).toBe(0);
    });
  });
});
