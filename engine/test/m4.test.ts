import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Store } from "../src/storage/db.js";
import { Executor } from "../src/run/executor.js";
import { McpClient } from "../src/plugins/mcp/client.js";
import { integrityHash, toolRisk, pluginSource } from "../src/plugins/mcp/manifest.js";
import type { Tile } from "../src/board/types.js";
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

describe("M4 MCP plugins (§15)", () => {
  describe("test_mcp_tool_import", () => {
    it("imports tools from a reference stdio server with manifest risk applied", async () => {
      const client = new McpClient(["node", REF_SERVER]);
      await client.connect();
      const tools = await client.listTools();
      client.close();

      expect(tools.map(t => t.name).sort()).toEqual(["delete_file", "read_file"]);

      const m = manifestOverride({ read_file: "read" });
      expect(toolRisk("read_file", m)).toBe("read");
      expect(toolRisk("delete_file", m)).toBe("irreversible");
    });

    it("defaults to irreversible when no manifest override exists", async () => {
      const client = new McpClient(["node", REF_SERVER]);
      await client.connect();
      const tools = await client.listTools();
      client.close();

      const m = manifestOverride({});
      for (const t of tools) {
        expect(toolRisk(t.name, m)).toBe("irreversible");
      }
    });

    it("computes integrity hash that changes when command changes", () => {
      const h1 = integrityHash(["node", REF_SERVER]);
      const h2 = integrityHash(["node", REF_SERVER, "--extra"]);
      expect(h1).not.toBe(h2);
      expect(h1).toMatch(/^sha256:/);
    });
  });

  describe("test_integrity_hash_change_refuses", () => {
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

  describe("test_reference_plugin_end_to_end", () => {
    it("runs the reference plugin's tools through a full board run with approval", async () => {
      const store = makeStore();

      const client = new McpClient(["node", REF_SERVER]);
      await client.connect();
      const mcpTools = await client.listTools();
      client.close();

      const m = manifestOverride({ read_file: "read" });
      const tools = mcpTools.map(t => ({
        name: t.name,
        description: t.description ?? "",
        risk: toolRisk(t.name, m),
        source: "mcp" as const,
      }));

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
      const board = {
        format: "patchbay.board", version: 1, name: "M4 end-to-end",
        tiles: [readTile, deleteTile, approveTile],
        wires: [
          { id: "w1", kind: "data", from: "read", to: "delete" },
          { id: "w2", kind: "permission", from: "approve-delete", to: "delete", grant: "invoke-action" },
        ],
      };

      const boardId = store.saveBoard("M4 board", board.tiles as unknown[], board.wires as unknown[]);
      const ex = new Executor(store, noopRunner());

      const result = await ex.run(board as any, boardId);
      expect(result.status).toBe("paused");
      expect(result.pausedTileId).toBe("delete");

      const resumed = await ex.resume(board as any, boardId, boardId, "approve");
      expect(resumed.status).toBe("completed");

      const audit = store.auditForRun(result.runId);
      const decisions = audit.map(a => a.decision);
      expect(decisions).toContain("auto");
      expect(decisions.filter(d => d === "auto").length).toBe(2);
    });
  });
});
