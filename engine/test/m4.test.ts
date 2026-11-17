import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { buildGraph } from "../src/graph/graph.js";
import { Executor } from "../src/run/executor.js";
import { Store } from "../src/storage/db.js";
import { Enforcer } from "../src/agents/runner.js";
import { integrityHash, toolRisk, pluginSource } from "../src/plugins/mcp/manifest.js";
import type { BoardFile, Tile } from "../src/board/types.js";
import type { PluginManifest } from "../src/plugins/mcp/manifest.js";

const REF_SERVER = path.join(process.cwd(), "test", "fixtures", "reference-mcp-server.js");

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-m4-"));
  return new Store(path.join(dir, "test.db"));
}

function noopRunner() {
  return async (tile: unknown) => {
    const t = tile as { id: string; name: string; risk?: string };
    return { ran: t.id, name: t.name, risk: t.risk };
  };
}

function manifestOverride(overrides: Record<string, "read" | "write" | "irreversible">): PluginManifest {
  return {
    name: "reference",
    version: "1.0.0",
    transport: "stdio",
    command: ["node", REF_SERVER],
    risk: { default: "irreversible", overrides },
  };
}

function given(store: Store, b: any, actionRunner: any) {
  const boardId = store.saveBoard("M4 board", b.tiles as unknown[], b.wires as unknown[]);
  const graph = buildGraph(b);
  const enforcer = new Enforcer(b, graph, store);
  const ex = new Executor(store, actionRunner, { enforcer });
  return { ex, boardId };
}

describe("M4 MCP plugins (§15)", () => {
  describe("manifest risk", () => {
    it("computes integrity hash that changes when command changes", () => {
      const h1 = integrityHash(["node", REF_SERVER]);
      const h2 = integrityHash(["node", REF_SERVER, "--extra"]);
      expect(h1).not.toBe(h2);
      expect(h1).toMatch(/^sha256:/);
    });

    it("applies manifest override to tool risk", () => {
      const m = manifestOverride({ read_file: "read" });
      expect(toolRisk("read_file", m)).toBe("read");
      expect(toolRisk("delete_file", m)).toBe("irreversible");
    });

    it("defaults to irreversible when no manifest override exists", () => {
      const m = manifestOverride({});
      for (const name of ["read_file", "delete_file"]) {
        expect(toolRisk(name, m)).toBe("irreversible");
      }
    });
  });

  describe("integrity hash storage", () => {
    it("stores and compares integrity hash; different hash detected", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      const source = JSON.stringify({ manifest: null, tools: [], importedAt: new Date().toISOString() });

      store.savePlugin(id, "ref-plugin", "1.0.0", source, integrityHash(["node", REF_SERVER]));
      const p = store.getPlugin(id);
      expect(p).toBeDefined();
      expect(p!.integrity_hash).toBe(integrityHash(["node", REF_SERVER]));

      const mutatedHash = integrityHash(["node", REF_SERVER, "--mutated"]);
      expect(p!.integrity_hash).not.toBe(mutatedHash);

      expect(store.getPlugins().length).toBe(1);
    });
  });

  describe("end-to-end with enforcer", () => {
    it("runs board through full flow: read auto, delete pauses for approval, approve completes", async () => {
      const store = makeStore();

      const m = manifestOverride({ read_file: "read" });
      const tools = [
        { name: "read_file", description: "Read a file", risk: toolRisk("read_file", m), source: "mcp" as const },
        { name: "delete_file", description: "Delete a file", risk: toolRisk("delete_file", m), source: "mcp" as const },
      ];

      const pluginId = crypto.randomUUID();
      const sourceJson = pluginSource(m, tools);
      const ih = integrityHash(["node", REF_SERVER]);
      store.savePlugin(pluginId, "reference", "1.0.0", sourceJson, ih);

      const readTile: Tile = {
        id: "read", kind: "action", name: "Read file", risk: "read",
        source: { type: "mcp", serverId: pluginId, tool: "read_file" },
      };
      const deleteTile: Tile = {
        id: "delete", kind: "action", name: "Delete file", risk: "irreversible",
        source: { type: "mcp", serverId: pluginId, tool: "delete_file" },
        autoApprove: { enabled: false },
      };
      const approveTile: Tile = {
        id: "approve-delete", kind: "approval", name: "Approve delete", notify: { channel: "desktop" },
      };
      const board: BoardFile = {
        format: "patchbay.board", version: 1, name: "M4 end-to-end",
        tiles: [readTile, deleteTile, approveTile],
        wires: [
          { id: "w1", kind: "data", from: "read", to: "delete" },
          { id: "w2", kind: "data", from: "approve-delete", to: "delete" },
        ],
      };

      const { ex, boardId } = given(store, board, noopRunner());

      // Run the board: read runs, delete pauses for approval (irreversible + enforcer)
      const result = await ex.run(board, boardId);
      expect(result.status).toBe("paused");
      expect(result.pausedTileId).toBe("delete");

      // Approve the delete action
      const resumed = await ex.resume(board, boardId, result.runId, "approve");
      expect(resumed.status).toBe("completed");

      // Verify audit trail covers both actions
      const audit = store.auditForRun(result.runId);
      const decisions = audit.map(a => a.decision);
      expect(decisions).toContain("auto");
      expect(decisions.filter(d => d === "auto").length).toBe(2);
    });
  });
});
