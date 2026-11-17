import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Enforcer } from "../src/agents/runner.js";
import { AgentRunner, type AgentRunDeps } from "../src/agents/runner.js";
import { buildGraph } from "../src/graph/graph.js";
import { Store } from "../src/storage/db.js";
import { Vault } from "../src/vault/vault.js";
import type { BoardFile, Tile } from "../src/board/types.js";

// ---- helpers ----
let tmp: string;
let store: Store;
let vault: Vault;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-m2-"));
  store = new Store(path.join(tmp, "t.db"));
  vault = new Vault(store.db);
  vault.unlock("test-passphrase");
});
afterEach(() => { store.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const tile = (id: string, kind: string, name = id, extra: object = {}): Tile =>
  ({ id, kind, name, ...extra } as Tile);

function board(tiles: Tile[], wires: unknown[]): BoardFile {
  return { format: "patchbay.board", version: 1, name: "m2", tiles, wires: wires as BoardFile["wires"] } as BoardFile;
}

function fakeChat(scripted: { text?: string; toolCalls: { id: string; name: string; args: unknown }[] }[]) {
  let i = 0;
  const calls: unknown[] = [];
  return {
    chat: async () => { const e = scripted[Math.min(i++, scripted.length - 1)]; return { toolCalls: [], ...e }; },
    calls,
  };
}

/** records every actionRunner invocation */
function recordingRunner() {
  const calls: { tile: Tile; args: unknown }[] = [];
  const runner = async (tile: Tile, args: unknown) => { calls.push({ tile, args }); return { ok: true }; };
  return { runner, calls };
}

// ---- M2 acceptance tests (SPEC.md §15) ----

describe("M2: permission model", () => {
  it("test_permission_denied_without_wire: intent without invoke-action wire is refused, no tool call, audit logs refused-permission", async () => {
    const b = board(
      [tile("ag", "agent", "Outreach", { model: { provider: "openai", model: "gpt-x" } }),
       tile("send_email", "action", "send_email", { source: { type: "http", method: "POST", url: "http://x" }, risk: "write" })],
      [], // NO wire
    );
    const graph = buildGraph(b);
    const boardId = store.saveBoard("m2", b.tiles, b.wires);
    const runId = store.newRun(boardId);
    const enforcer = new Enforcer(b, graph, store);
    const resolution = enforcer.resolve({ tileId: "ag", actionTileId: "send_email", intentKind: "invoke-action" });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.error).toBe("permission_denied");
      expect(resolution.detail).toContain("no invoke-action wire");
      expect(resolution.hint).toContain("Wire it on the board");
    }
    // no tool call is made: the recording runner sees nothing
    const { runner, calls } = recordingRunner();
    expect(calls).toHaveLength(0);

    // full loop: the refusal reaches the agent as a normal tool result
    const scripted = fakeChat([{ toolCalls: [{ id: "t1", name: "send_email", args: { to: "a@b.c" } }] }, { text: "done" }]);
    const deps: AgentRunDeps = { store, vault, actionRunner: runner, chat: scripted.chat };
    const agentRunner = new AgentRunner(deps);
    await agentRunner.runAgent(b, boardId, runId, graph, "ag", "send an email");
    expect(calls).toHaveLength(0);
    const audit = store.auditForRun(runId);
    expect(audit.some((a) => a.decision === "refused-permission" && a.tile_id === "ag")).toBe(true);
  });

  it("test_handoff_without_wire_is_refused: agent A cannot hand to agent B without a handoff-task wire", () => {
    const b = board(
      [tile("a", "agent"), tile("b", "agent")],
      [], // no agent->agent wire
    );
    const enforcer = new Enforcer(b, buildGraph(b), store);
    const r = enforcer.resolve({ tileId: "a", actionTileId: "b", intentKind: "handoff-task" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("permission_denied");
      expect(r.detail).toContain("no handoff-task wire");
    }
  });

  it("test_memory_isolation: B reads own memory fine; A's memory without a wire is invisible to B", async () => {
    // memory tiles for A and B; only B's memory is wired to B
    const memA = tile("memA", "memory", "A memory", { scope: "agent" });
    const memB = tile("memB", "memory", "B memory", { scope: "agent" });
    store.writeMemory("memA", "board", "A knows the launch date");
    const b = board(
      [tile("a", "agent"), tile("b", "agent"), memA, memB],
      [{ id: "w1", kind: "permission", from: "memB", to: "b", grant: "read-context" }], // B wired to memB only
    );
    const enforcer = new Enforcer(b, buildGraph(b), store);
    // B reads its own memory: it appears in B's prompt assembly
    const bContexts = enforcer.wiredContexts("b");
    expect(bContexts.map((t) => t.id)).toEqual(["memB"]);
    // A's memory never appears in B's prompt: only wired contexts are assembled
    expect(bContexts.map((t) => t.id)).not.toContain("memA");
    // B attempting to write to A's memory without a wire is refused
    const w = enforcer.resolve({ tileId: "b", actionTileId: "memA", intentKind: "write-memory" });
    expect(w.ok).toBe(false);
  });

  it("test_table_write_without_wire: refused, naming the missing write-table grant", () => {
    const t = tile("leads", "table", "Leads", { columns: [{ name: "email", type: "text" }] });
    const b = board([tile("ag", "agent"), t], []); // no wire
    const enforcer = new Enforcer(b, buildGraph(b), store);
    const r = enforcer.resolve({ tileId: "ag", actionTileId: "leads", intentKind: "write-table" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.detail).toContain("write-table");
      expect(r.detail).toContain("Leads");
    }
  });

  it("test_context_scoping: an agent wired to one of two contexts receives only that one", async () => {
    const c1 = tile("c1", "context", "Public brief", { source: "inline", content: "PUBLIC-CONTENT" });
    const c2 = tile("c2", "context", "Secrets doc", { source: "inline", content: "SECRET-CONTENT" });
    const b = board(
      [tile("ag", "agent", "A", { model: { provider: "openai", model: "m" } }), c1, c2],
      [{ id: "w1", kind: "permission", from: "c1", to: "ag", grant: "read-context" }], // only c1 wired
    );
    const seenMessages: unknown[] = [];
    const deps: AgentRunDeps = {
      store, vault, actionRunner: recordingRunner().runner,
      chat: async (_ref, messages) => { seenMessages.push(messages); return { text: "ok", toolCalls: [] }; },
    };
    const boardId = store.saveBoard("m2", b.tiles, b.wires);
    const runId = store.newRun(boardId);
    await new AgentRunner(deps).runAgent(b, boardId, runId, buildGraph(b), "ag", "go");
    const serialized = JSON.stringify(seenMessages);
    expect(serialized).toContain("PUBLIC-CONTENT");
    expect(serialized).not.toContain("SECRET-CONTENT");
  });

  it("test_vault_isolation: an unwired vault key is never present in any provider-bound request", async () => {
    vault.set("slack.bot_token", "xoxb-SUPERSECRET");
    vault.set("api.key", "APISECRET");
    const v = tile("v", "vault", "Creds", { keys: [{ key: "slack.bot_token", title: "Slack" }, { key: "api.key", title: "API" }] });
    const act = tile("post", "action", "post", {
      source: { type: "http", method: "POST", url: "https://api.example.test/x",
                headers: { authorization: "Bearer ${vault:slack.bot_token}" } },
      risk: "write",
    });
    const b = board(
      [tile("ag", "agent", "A", { model: { provider: "openai", model: "m" } }), v, act],
      [
        { id: "w1", kind: "permission", from: "post", to: "ag", grant: "invoke-action" },
        { id: "w2", kind: "permission", from: "v", to: "ag", grant: "use-credentials" }, // wired: whole vault tile
      ],
    );
    // unwired variant: agent has NO use-credentials wire
    const bUnwired: BoardFile = { ...b, wires: b.wires.filter((w) => w.id !== "w2") };
    const seenArgs: unknown[] = [];
    const scripted = fakeChat([
      { toolCalls: [{ id: "t1", name: "post", args: { body: "hi ${vault:api.key} auth ${vault:slack.bot_token}" } }] },
      { text: "done" },
    ]);
    const deps: AgentRunDeps = {
      store, vault, actionRunner: async (_t, args) => { seenArgs.push(args); return { ok: true }; },
      chat: scripted.chat,
    };
    const boardId = store.saveBoard("m2", bUnwired.tiles, bUnwired.wires);
    const runId = store.newRun(boardId);
    await new AgentRunner(deps).runAgent(bUnwired, boardId, runId, buildGraph(bUnwired), "ag", "post it");
    const serialized = JSON.stringify(seenArgs);
    expect(serialized).not.toContain("xoxb-SUPERSECRET");
    expect(serialized).not.toContain("APISECRET");
    expect(serialized).toContain("***unwired:");
  });

  it("wired vault keys ARE substituted into the action args", async () => {
    vault.set("api.key", "APISECRET");
    const v = tile("v", "vault", "Creds", { keys: [{ key: "api.key", title: "API" }] });
    const act = tile("call", "action", "call", {
      source: { type: "http", method: "POST", url: "https://api.example.test/x",
                headers: { authorization: "Bearer ${vault:api.key}" } },
      risk: "read",
    });
    const b = board(
      [tile("ag", "agent", "A", { model: { provider: "openai", model: "m" } }), v, act],
      [
        { id: "w1", kind: "permission", from: "call", to: "ag", grant: "invoke-action" },
        { id: "w2", kind: "permission", from: "v", to: "ag", grant: "use-credentials" },
      ],
    );
    const seenArgs: unknown[] = [];
    const scripted = fakeChat([
      { toolCalls: [{ id: "t1", name: "call", args: { headers: { authorization: "Bearer ${vault:api.key}" } } }] },
      { text: "done" },
    ]);
    const deps: AgentRunDeps = {
      store, vault, actionRunner: async (_t, args) => { seenArgs.push(args); return { ok: true }; },
      chat: scripted.chat,
    };
    const boardId = store.saveBoard("m2", b.tiles, b.wires);
    const runId = store.newRun(boardId);
    await new AgentRunner(deps).runAgent(b, boardId, runId, buildGraph(b), "ag", "call it");
    expect(JSON.stringify(seenArgs)).toContain("Bearer APISECRET");
  });

  it("test_memory_lru_trim: maxEntries 500 trims to 500 on the 501st write, oldest first", () => {
    for (let i = 1; i <= 501; i++) store.writeMemory("m", "board", `entry-${i}`, 500);
    const mem = store.readMemory("m");
    expect(mem).toHaveLength(500);
    expect(mem).not.toContain("entry-1"); // oldest trimmed
    expect(mem).toContain("entry-501");   // newest kept
    expect(mem).toContain("entry-2");     // second-oldest survives: exactly one trim
  });
});
